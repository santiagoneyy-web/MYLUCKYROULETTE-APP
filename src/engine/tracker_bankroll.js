const POCKETS_PER_BET = 9;
const HIT_RETURN_MULTIPLIER = 4;
const DOUBLING_EVERY_ROUNDS = 2;
const DIRECTION_ZONE_MAX_ROUND = 80;
const DIRECTION_ZONE_STAKE_TIERS = [
    { through: 35, multiplier: 1 },
    { through: 55, multiplier: 2 },
    { through: 70, multiplier: 4 },
    { through: 80, multiplier: 8 }
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

function getDirectionZoneStake(baseStake, round) {
    if (!Number.isFinite(baseStake) || baseStake <= 0 || !Number.isInteger(round) || round < 1 || round > DIRECTION_ZONE_MAX_ROUND) {
        throw new RangeError('Monto base y ronda de estrategia inválidos.');
    }
    const tier = DIRECTION_ZONE_STAKE_TIERS.find(item => round <= item.through);
    return money(baseStake * tier.multiplier);
}

function calculateDirectionZoneSettlement(session, number, predictionNumbers, metricLabel) {
    const round = Number(session.current_round);
    const stake = getDirectionZoneStake(Number(session.chip_value), round);
    const won = predictionNumbers.includes(number);
    const cycleWagered = money(Number(session.cycle_wagered || 0) + stake);
    const cyclePayout = money(Number(session.cycle_payout || 0) + (won ? stake * HIT_RETURN_MULTIPLIER : 0));
    const balanceAfter = money(Number(session.balance) - stake + (won ? stake * HIT_RETURN_MULTIPLIER : 0));
    const sameMetricAsStreak = String(session.strategy_streak_metric || '') === String(metricLabel || '');
    const streakBeforeReset = won
        ? (sameMetricAsStreak ? Number(session.strategy_streak_hits || 0) + 1 : 1)
        : 0;
    const strategyCycleCompleted = won && streakBeforeReset >= 3;
    const roundLimitReached = round >= DIRECTION_ZONE_MAX_ROUND;

    return {
        won,
        round,
        stake,
        cycleWagered,
        cyclePayout,
        payout: won ? money(stake * HIT_RETURN_MULTIPLIER) : 0,
        cycleProfit: strategyCycleCompleted ? money(cyclePayout - cycleWagered) : null,
        balanceAfter,
        netProfit: money(balanceAfter - Number(session.initial_capital)),
        nextRound: roundLimitReached ? round : strategyCycleCompleted ? 1 : round + 1,
        nextCycleWagered: strategyCycleCompleted ? 0 : cycleWagered,
        nextCyclePayout: strategyCycleCompleted ? 0 : cyclePayout,
        nextStrategyStreakHits: strategyCycleCompleted ? 0 : streakBeforeReset,
        nextStrategyStreakMetric: strategyCycleCompleted || !won ? '' : String(metricLabel || ''),
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
    getStake,
    getDirectionZoneStake,
    calculateDirectionZoneSettlement,
    calculateSettlement,
    getSessionOutcome
};
