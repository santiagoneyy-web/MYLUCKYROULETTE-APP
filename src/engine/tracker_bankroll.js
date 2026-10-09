const POCKETS_PER_BET = 9;
const HIT_RETURN_MULTIPLIER = 4;
const DOUBLING_EVERY_ROUNDS = 2;
const DIRECTION_ZONE_MAX_ROUND = 80;
const DIRECTION_ZONE_MAX_STREAK = 3;
const DIRECTION_ZONE_RANGES = [
    { first: 1, last: 35, multiplier: 1 },
    { first: 36, last: 55, multiplier: 2 },
    { first: 56, last: 70, multiplier: 4 },
    { first: 71, last: 80, multiplier: 8 }
];

function money(value) {
    return Number(Number(value).toFixed(2));
}

function getStake(chipValue, round) {
    if (!Number.isFinite(chipValue) || chipValue <= 0 || !Number.isInteger(round) || round < 1) {
        throw new RangeError('Valor de ficha y ronda inválidos.');
    }
    return money(chipValue * POCKETS_PER_BET * 2 ** Math.floor((round - 1) / DOUBLING_EVERY_ROUNDS));
}

function getDirectionZoneRange(round) {
    if (!Number.isInteger(round) || round < 1 || round > DIRECTION_ZONE_MAX_ROUND) {
        throw new RangeError('Ronda de estrategia inválida.');
    }
    return DIRECTION_ZONE_RANGES.find(range => round >= range.first && round <= range.last);
}

function getDirectionZoneBaseStake(baseStake, round) {
    if (!Number.isFinite(baseStake) || baseStake <= 0) {
        throw new RangeError('Monto base de estrategia inválido.');
    }
    const range = getDirectionZoneRange(round);
    return money(baseStake * range.multiplier);
}

function getDirectionZoneStake(baseStake, round, nextStake = null, streakHits = 0) {
    const savedNextStake = Number(nextStake);
    if (Number.isFinite(savedNextStake) && savedNextStake > 0) return money(savedNextStake);
    const completedHits = Math.max(0, Math.min(DIRECTION_ZONE_MAX_STREAK - 1, Math.floor(Number(streakHits) || 0)));
    return money(getDirectionZoneBaseStake(baseStake, round) * HIT_RETURN_MULTIPLIER ** completedHits);
}

function getDirectionZoneRound(session) {
    const completedBets = Math.max(0, Math.floor(Number(session?.total_spins) || 0));
    return Math.min(DIRECTION_ZONE_MAX_ROUND, completedBets + 1);
}

function calculateDirectionZoneSettlement(session, number, predictionNumbers, metricLabel, stakeOverride = null) {
    if (Number(session.total_spins || 0) >= DIRECTION_ZONE_MAX_ROUND) {
        throw new RangeError('La estrategia ya completó sus 80 apuestas.');
    }
    const round = getDirectionZoneRound(session);
    const stake = getDirectionZoneStake(
        Number(session.chip_value), round,
        stakeOverride ?? session.strategy_next_stake,
        session.strategy_streak_hits
    );
    const won = predictionNumbers.includes(number);
    const priorHits = Math.max(0, Math.floor(Number(session.strategy_streak_hits) || 0));
    const sameMetricAsStreak = priorHits > 0 &&
        String(session.strategy_streak_metric || '') === String(metricLabel || '');
    const cycleWagered = money(Number(session.cycle_wagered || 0) + stake);
    const cyclePayout = money(Number(session.cycle_payout || 0) + (won ? stake * HIT_RETURN_MULTIPLIER : 0));
    const balanceAfter = money(Number(session.balance) - stake + (won ? stake * HIT_RETURN_MULTIPLIER : 0));
    const streakBeforeReset = won
        ? (sameMetricAsStreak ? priorHits + 1 : 1)
        : 0;
    const strategyCycleCompleted = won && sameMetricAsStreak && streakBeforeReset >= DIRECTION_ZONE_MAX_STREAK;
    const roundLimitReached = round >= DIRECTION_ZONE_MAX_ROUND;
    const nextRound = roundLimitReached ? round : round + 1;
    const resetProgression = !won || strategyCycleCompleted;
    const nextStrategyStake = roundLimitReached ? null : resetProgression
        ? getDirectionZoneBaseStake(Number(session.chip_value), nextRound)
        : money(stake * HIT_RETURN_MULTIPLIER);
    const resetCycle = !won || strategyCycleCompleted;

    return {
        won,
        round,
        stake,
        cycleWagered,
        cyclePayout,
        payout: won ? money(stake * HIT_RETURN_MULTIPLIER) : 0,
        cycleProfit: resetCycle ? money(cyclePayout - cycleWagered) : null,
        balanceAfter,
        netProfit: money(balanceAfter - Number(session.initial_capital)),
        nextRound,
        nextCycleWagered: resetCycle ? 0 : cycleWagered,
        nextCyclePayout: resetCycle ? 0 : cyclePayout,
        nextStrategyStreakHits: strategyCycleCompleted ? 0 : streakBeforeReset,
        nextStrategyStreakMetric: strategyCycleCompleted || !won ? '' : String(metricLabel || ''),
        nextStrategyStake,
        strategyStreakHitsForEntry: streakBeforeReset,
        strategyCycleCompleted,
        roundLimitReached
    };
}

function calculateSettlement(session, number, predictionNumbers) {
    const round = session.current_round;
    const stake = getStake(session.chip_value, round);
    const won = predictionNumbers.includes(number);
    const cycleWagered = money(session.cycle_wagered + stake);
    const payout = won ? money(stake * HIT_RETURN_MULTIPLIER) : 0;
    const balanceAfter = money(session.balance - stake + payout);

    return {
        won,
        round,
        stake,
        cycleWagered,
        payout,
        cycleProfit: won ? money(payout - cycleWagered) : null,
        balanceAfter,
        netProfit: money(balanceAfter - session.initial_capital),
        nextRound: won ? 1 : round + 1,
        nextCycleWagered: won ? 0 : cycleWagered
    };
}

function getSessionOutcome(balance, initialCapital) {
    const difference = money(balance - initialCapital);
    return difference > 0 ? 'won' : difference < 0 ? 'lost' : 'break_even';
}

module.exports = {
    POCKETS_PER_BET,
    HIT_RETURN_MULTIPLIER,
    DOUBLING_EVERY_ROUNDS,
    DIRECTION_ZONE_MAX_ROUND,
    DIRECTION_ZONE_RANGES,
    getStake,
    getDirectionZoneRange,
    getDirectionZoneBaseStake,
    getDirectionZoneStake,
    getDirectionZoneRound,
    calculateDirectionZoneSettlement,
    calculateSettlement,
    getSessionOutcome
};
