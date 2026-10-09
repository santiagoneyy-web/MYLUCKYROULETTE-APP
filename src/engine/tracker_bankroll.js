const POCKETS_PER_BET = 9;
const HIT_RETURN_MULTIPLIER = 4;
const DOUBLING_EVERY_ROUNDS = 2;
const DIRECTION_ZONE_MAX_ROUND = 80;
const DIRECTION_ZONE_MAX_STREAK = 3;
const SOFT_BLOCK7_MAX_ROUND = 40;
const SOFT_BLOCK7_MAX_STREAK = 2;
const SOFT_BLOCK7_HIT_RETURN_MULTIPLIER = HIT_RETURN_MULTIPLIER;
const SOFT_BLOCK7_CYCLE_PAYOUT_MULTIPLIER = 16;
const DIRECTION_ZONE_RANGES = [
    { first: 1, last: 35, multiplier: 1 },
    { first: 36, last: 55, multiplier: 2 },
    { first: 56, last: 70, multiplier: 4 },
    { first: 71, last: 80, multiplier: 8 }
];
const SOFT_BLOCK7_RANGES = [
    { first: 1, last: 7, multiplier: 1 },
    { first: 8, last: 14, multiplier: 2 },
    { first: 15, last: 21, multiplier: 4 },
    { first: 22, last: 28, multiplier: 8 },
    { first: 29, last: 35, multiplier: 16 },
    { first: 36, last: 40, multiplier: 32 }
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

function getSoftBlock7Range(round) {
    if (!Number.isInteger(round) || round < 1 || round > SOFT_BLOCK7_MAX_ROUND) {
        throw new RangeError('Ronda SOFT inválida.');
    }
    return SOFT_BLOCK7_RANGES.find(range => round >= range.first && round <= range.last);
}

function getSoftBlock7Round(session) {
    const completedBets = Math.max(0, Math.floor(Number(session?.total_spins) || 0));
    return Math.min(SOFT_BLOCK7_MAX_ROUND, completedBets + 1);
}

function getSoftBlock7Stake(baseStake, round, nextStake = null, streakHits = 0) {
    if (!Number.isFinite(baseStake) || baseStake <= 0) {
        throw new RangeError('Apuesta base SOFT inválida.');
    }
    const savedNextStake = Number(nextStake);
    if (Number.isFinite(savedNextStake) && savedNextStake > 0) return money(savedNextStake);
    const completedHits = Math.max(0, Math.min(SOFT_BLOCK7_MAX_STREAK - 1, Math.floor(Number(streakHits) || 0)));
    return money(baseStake * getSoftBlock7Range(round).multiplier * SOFT_BLOCK7_HIT_RETURN_MULTIPLIER ** completedHits);
}

function calculateSoftBlock7Settlement(session, number, predictionNumbers, metricLabel = '') {
    if (Number(session.total_spins || 0) >= SOFT_BLOCK7_MAX_ROUND) {
        throw new RangeError('La estrategia SOFT ya completó sus 40 rondas.');
    }
    const round = getSoftBlock7Round(session);
    const priorHits = Math.max(0, Math.floor(Number(session.strategy_streak_hits) || 0));
    const stake = getSoftBlock7Stake(
        Number(session.chip_value), round,
        session.strategy_next_stake,
        priorHits
    );
    const won = predictionNumbers.includes(number);
    const sameMetricAsStreak = priorHits > 0 &&
        String(session.strategy_streak_metric || '') === String(metricLabel || '');
    const streakBeforeReset = won
        ? (sameMetricAsStreak ? priorHits + 1 : 1)
        : 0;
    const strategyCycleCompleted = won && sameMetricAsStreak && streakBeforeReset >= SOFT_BLOCK7_MAX_STREAK;
    const payout = won ? money(stake * SOFT_BLOCK7_HIT_RETURN_MULTIPLIER) : 0;
    const cycleWagered = money(Number(session.cycle_wagered || 0) + stake);
    const cyclePayout = money(Number(session.cycle_payout || 0) + payout);
    const balanceAfter = money(Number(session.balance) - stake + payout);
    const roundLimitReached = round >= SOFT_BLOCK7_MAX_ROUND;
    const nextRound = roundLimitReached ? round : round + 1;
    const resetProgression = !won || strategyCycleCompleted;
    const nextStrategyStake = roundLimitReached ? null : resetProgression
        ? getSoftBlock7Stake(Number(session.chip_value), nextRound)
        : payout;
    const resetCycle = !won || strategyCycleCompleted;

    return {
        won,
        round,
        stake,
        payout,
        cycleWagered,
        cyclePayout,
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
        roundLimitReached,
        metricLabel: String(metricLabel || '')
    };
}

function recalculateSoftBlock7History(session, entries) {
    const orderedEntries = [...entries].sort((left, right) => Number(left.round || 0) - Number(right.round || 0));
    if (orderedEntries.length !== Number(session.total_spins || 0) || orderedEntries.length > SOFT_BLOCK7_MAX_ROUND) return null;

    let state = {
        ...session,
        balance: Number(session.initial_capital),
        current_round: 1,
        cycle_wagered: 0,
        cycle_payout: 0,
        strategy_next_stake: getSoftBlock7Stake(Number(session.chip_value), 1),
        strategy_streak_hits: 0,
        strategy_streak_metric: '',
        wins: 0,
        losses: 0,
        total_spins: 0,
        total_wagered: 0,
        total_payout: 0,
        completed_cycles: 0
    };
    const recalculatedEntries = [];

    for (const entry of orderedEntries) {
        const metricLabel = String(entry.strategy_metric_label || '');
        const predictionNumbers = Array.isArray(entry.prediction_numbers) ? entry.prediction_numbers : [];
        const settlement = calculateSoftBlock7Settlement(state, Number(entry.number), predictionNumbers, metricLabel);
        recalculatedEntries.push({
            _id: entry._id,
            cycle_no: state.completed_cycles + 1,
            round: settlement.round,
            stake: settlement.stake,
            cycle_wagered: settlement.cycleWagered,
            cycle_payout: settlement.cyclePayout,
            payout: settlement.payout,
            cycle_profit: settlement.cycleProfit,
            strategy_streak_hits: settlement.strategyStreakHitsForEntry,
            strategy_cycle_completed: settlement.strategyCycleCompleted,
            balance_after: settlement.balanceAfter,
            net_profit: settlement.netProfit,
            won: settlement.won
        });
        state = {
            ...state,
            balance: settlement.balanceAfter,
            current_round: settlement.nextRound,
            cycle_wagered: settlement.nextCycleWagered,
            cycle_payout: settlement.nextCyclePayout,
            strategy_next_stake: settlement.nextStrategyStake,
            strategy_streak_hits: settlement.nextStrategyStreakHits,
            strategy_streak_metric: settlement.nextStrategyStreakMetric,
            total_spins: state.total_spins + 1,
            total_wagered: money(state.total_wagered + settlement.stake),
            total_payout: money(state.total_payout + settlement.payout),
            completed_cycles: state.completed_cycles + Number(settlement.strategyCycleCompleted),
            wins: state.completed_cycles + Number(settlement.strategyCycleCompleted),
            losses: state.losses + Number(!settlement.won)
        };
    }

    return { session: state, entries: recalculatedEntries };
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
    SOFT_BLOCK7_MAX_ROUND,
    SOFT_BLOCK7_MAX_STREAK,
    SOFT_BLOCK7_HIT_RETURN_MULTIPLIER,
    SOFT_BLOCK7_CYCLE_PAYOUT_MULTIPLIER,
    DIRECTION_ZONE_RANGES,
    SOFT_BLOCK7_RANGES,
    getStake,
    getDirectionZoneRange,
    getDirectionZoneBaseStake,
    getDirectionZoneStake,
    getDirectionZoneRound,
    getSoftBlock7Range,
    getSoftBlock7Round,
    getSoftBlock7Stake,
    calculateDirectionZoneSettlement,
    calculateSoftBlock7Settlement,
    recalculateSoftBlock7History,
    calculateSettlement,
    getSessionOutcome
};
