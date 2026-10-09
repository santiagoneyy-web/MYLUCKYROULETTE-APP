const assert = require('node:assert/strict');
const {
    getStake,
    calculateSettlement,
    getSessionOutcome,
    getDirectionZoneRange,
    getDirectionZoneRound,
    getDirectionZoneBaseStake,
    getDirectionZoneStake,
    calculateDirectionZoneSettlement,
    DIRECTION_ZONE_MAX_ROUND
} = require('./src/engine/tracker_bankroll');
const { wheelNeighbors } = require('./src/engine/analytics_snapshot');
const {
    WHEEL_ORDER, WHEEL_INDEX, getDirectionZoneTarget, getDirectionZoneMetricLabel
} = require('./src/engine/predictor');

assert.deepEqual(
    Array.from({ length: 10 }, (_, index) => getStake(0.5, index + 1)),
    [4.5, 4.5, 9, 9, 18, 18, 36, 36, 72, 72]
);
assert.equal(getStake(0.4, 1), 3.6);

const n4 = wheelNeighbors(8, 4);
const predictionSession = { initial_capital: 100, balance: 100, chip_value: 0.5, current_round: 1, cycle_wagered: 0 };
assert.equal(n4.length, 9);
assert.equal(new Set(n4).size, 9);
assert.ok(n4.includes(8));
for (let center = 0; center <= 36; center++) {
    const prediction = wheelNeighbors(center, 4);
    assert.equal(prediction.length, 9);
    assert.equal(new Set(prediction).size, 9);
    assert.ok(prediction.includes(center));
}
assert.equal(calculateSettlement(predictionSession, n4[0], n4).won, true);
const outsideN4 = Array.from({ length: 37 }, (_, number) => number).find(number => !n4.includes(number));
assert.equal(calculateSettlement(predictionSession, outsideN4, n4).won, false);

let cycleSpend = 0;
for (let round = 1; round <= 2; round++) {
    const stake = getStake(0.4, round);
    cycleSpend = Number((cycleSpend + stake).toFixed(2));
}
assert.equal(Number((cycleSpend + getStake(0.4, 3)).toFixed(2)), 14.4);

let threeMisses = { initial_capital: 200, balance: 200, chip_value: 0.5, current_round: 1, cycle_wagered: 0, losses: 0 };
let threeMissesTotal = 0;
for (let spin = 0; spin < 3; spin++) {
    const settled = calculateSettlement(threeMisses, 0, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    threeMissesTotal = Number((threeMissesTotal + settled.stake).toFixed(2));
    threeMisses = {
        ...threeMisses,
        balance: settled.balanceAfter,
        current_round: settled.nextRound,
        cycle_wagered: settled.nextCycleWagered,
        total_spins: spin + 1,
        total_wagered: threeMissesTotal,
        losses: threeMisses.losses + (settled.won ? 0 : 1)
    };
}
const nextStake = getStake(threeMisses.chip_value, threeMisses.current_round);
assert.equal(threeMisses.current_round, 4);
assert.equal(threeMisses.total_spins, 3);
assert.equal(threeMisses.losses, 3);
assert.equal(threeMisses.cycle_wagered, 18);
assert.equal(threeMisses.total_wagered, 18);
assert.equal(threeMisses.balance, 182);
assert.equal(nextStake, 9);
assert.equal(Number((threeMisses.cycle_wagered + nextStake).toFixed(2)), 27);
assert.equal(nextStake * 4, 36);
assert.equal(Number((nextStake * 4 - threeMisses.cycle_wagered - nextStake).toFixed(2)), 9);

const base = { initial_capital: 100, balance: 100, chip_value: 0.5, current_round: 1, cycle_wagered: 0 };
const miss = calculateSettlement(base, 0, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
assert.equal(miss.won, false);
assert.equal(miss.balanceAfter, 95.5);
assert.equal(miss.nextRound, 2);
assert.equal(miss.cycleProfit, null);

const hit = calculateSettlement({ ...base, balance: 95.5, current_round: 2, cycle_wagered: 4.5 }, 9, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
assert.equal(hit.payout, 18);
assert.equal(hit.cycleProfit, 9);
assert.equal(hit.balanceAfter, 109);
assert.equal(hit.netProfit, 9);
assert.equal(hit.nextRound, 1);
assert.equal(hit.nextCycleWagered, 0);

let session = { ...base, initial_capital: 200, balance: 200 };
let result;
for (let round = 1; round <= 5; round++) {
    result = calculateSettlement(session, round === 5 ? 9 : 0, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    session = {
        ...session,
        balance: result.balanceAfter,
        current_round: result.nextRound,
        cycle_wagered: result.nextCycleWagered
    };
}
assert.equal(result.stake, 18);
assert.equal(result.cycleWagered, 45);
assert.equal(result.payout, 72);
assert.equal(result.cycleProfit, 27);
assert.equal(result.netProfit, 27);
assert.equal(getSessionOutcome(session.balance, session.initial_capital), 'won');
assert.equal(getSessionOutcome(90, 100), 'lost');
assert.equal(getSessionOutcome(100, 100), 'break_even');

// Excel schedule: 35 rounds at 9, 20 at 18, 15 at 36, and 10 at 72.
for (const [round, expectedBase, expectedRange] of [
    [1, 9, [1, 35]], [35, 9, [1, 35]], [36, 18, [36, 55]], [55, 18, [36, 55]],
    [56, 36, [56, 70]], [70, 36, [56, 70]], [71, 72, [71, 80]], [80, 72, [71, 80]]
]) {
    const range = getDirectionZoneRange(round);
    assert.deepEqual([range.first, range.last], expectedRange);
    assert.equal(getDirectionZoneBaseStake(9, round), expectedBase);
}
const rangeCounts = new Map();
let flatScheduleTotal = 0;
for (let round = 1; round <= DIRECTION_ZONE_MAX_ROUND; round++) {
    const range = getDirectionZoneRange(round);
    rangeCounts.set(range.multiplier, (rangeCounts.get(range.multiplier) || 0) + 1);
    flatScheduleTotal += getDirectionZoneBaseStake(9, round);
}
assert.deepEqual([...rangeCounts.entries()], [[1, 35], [2, 20], [4, 15], [8, 10]]);
assert.equal(flatScheduleTotal, 1935);
assert.equal(getDirectionZoneRound({ total_spins: 0 }), 1);
assert.equal(getDirectionZoneRound({ total_spins: 79 }), 80);
assert.equal(DIRECTION_ZONE_MAX_ROUND, 80);

function applyDirectionZoneBet(session, won, metricLabel = 'CW_N4S') {
    const round = getDirectionZoneRound(session);
    const stake = getDirectionZoneStake(
        session.chip_value, round, session.strategy_next_stake, session.strategy_streak_hits
    );
    const settlement = calculateDirectionZoneSettlement(
        session, won ? 8 : 0, won ? [8] : [1, 2, 3, 4, 5, 6, 7, 9, 10], metricLabel, stake
    );
    return {
        settlement,
        session: {
            ...session,
            balance: settlement.balanceAfter,
            current_round: settlement.nextRound,
            total_spins: Number(session.total_spins || 0) + 1,
            cycle_wagered: settlement.nextCycleWagered,
            cycle_payout: settlement.nextCyclePayout,
            strategy_next_stake: settlement.nextStrategyStake,
            strategy_streak_hits: settlement.nextStrategyStreakHits,
            strategy_streak_metric: settlement.nextStrategyStreakMetric
        }
    };
}

// Each 4× ladder completes only on three wins in the same metric, then resets to the base
// of the current global range (not a fixed round-1-of-3 counter).
for (const [firstRound, baseStake] of [[1, 9], [36, 18], [56, 36], [71, 72]]) {
    let progression = {
        initial_capital: 100000, balance: 100000, chip_value: 9,
        total_spins: firstRound - 1, cycle_wagered: 0, cycle_payout: 0,
        strategy_next_stake: null, strategy_streak_hits: 0, strategy_streak_metric: ''
    };
    const stakes = [];
    for (let hit = 1; hit <= 3; hit++) {
        const result = applyDirectionZoneBet(progression, true, 'CCW_N4S');
        stakes.push(result.settlement.stake);
        progression = result.session;
        assert.equal(result.settlement.strategyCycleCompleted, hit === 3);
    }
    assert.deepEqual(stakes, [baseStake, baseStake * 4, baseStake * 16]);
    assert.equal(progression.strategy_streak_hits, 0);
    assert.equal(progression.strategy_next_stake, getDirectionZoneBaseStake(9, firstRound + 3));
    assert.equal(Number((progression.balance - 100000).toFixed(2)), baseStake * 63);
}

// A successful 4× bet keeps compounding even when its direction/zone changes;
// only the CHECK streak restarts. A miss then resets to the current range's base.
let compound = {
    initial_capital: 1000, balance: 1000, chip_value: 9, total_spins: 0,
    cycle_wagered: 0, cycle_payout: 0, strategy_next_stake: 9,
    strategy_streak_hits: 0, strategy_streak_metric: ''
};
let betResult = applyDirectionZoneBet(compound, true, 'CW_N4S');
assert.equal(betResult.settlement.stake, 9);
compound = betResult.session;
betResult = applyDirectionZoneBet(compound, true, 'CW_N4S');
assert.equal(betResult.settlement.stake, 36);
compound = betResult.session;
betResult = applyDirectionZoneBet(compound, true, 'CCW_N4B');
assert.equal(betResult.settlement.stake, 144);
assert.equal(betResult.settlement.strategyCycleCompleted, false);
assert.equal(betResult.settlement.strategyStreakHitsForEntry, 1);
assert.equal(betResult.settlement.nextStrategyStake, 576);
assert.equal(betResult.settlement.balanceAfter, 1567);
compound = betResult.session;
betResult = applyDirectionZoneBet(compound, false, 'CCW_N4B');
assert.equal(betResult.settlement.stake, 576);
assert.equal(betResult.settlement.strategyStreakHitsForEntry, 0);
assert.equal(betResult.settlement.balanceAfter, 991);
assert.equal(betResult.settlement.cycleProfit, -9);
assert.equal(betResult.settlement.nextCycleWagered, 0);
assert.equal(betResult.settlement.nextCyclePayout, 0);
assert.equal(betResult.settlement.nextStrategyStake, 9);

// A loss at a range boundary advances the global round and applies the next base tier.
const boundaryLoss = calculateDirectionZoneSettlement({
    initial_capital: 1000, balance: 1000, chip_value: 9, total_spins: 34,
    cycle_wagered: 0, cycle_payout: 0, strategy_next_stake: 9,
    strategy_streak_hits: 0, strategy_streak_metric: ''
}, 0, [1, 2, 3, 4, 5, 6, 7, 8, 9], 'CW_N4S');
assert.equal(boundaryLoss.round, 35);
assert.equal(boundaryLoss.nextRound, 36);
assert.equal(boundaryLoss.nextStrategyStake, 18);

// Run the complete 80-round flat-base schedule: every actual bet advances exactly once.
let fullRange = {
    initial_capital: 100000, balance: 100000, chip_value: 9, total_spins: 0,
    cycle_wagered: 0, cycle_payout: 0, strategy_next_stake: 9,
    strategy_streak_hits: 0, strategy_streak_metric: ''
};
const countedRounds = [];
for (let expectedRound = 1; expectedRound <= 80; expectedRound++) {
    const stake = getDirectionZoneStake(
        fullRange.chip_value, getDirectionZoneRound(fullRange), fullRange.strategy_next_stake,
        fullRange.strategy_streak_hits
    );
    const settled = calculateDirectionZoneSettlement(
        fullRange, 0, [1, 2, 3, 4, 5, 6, 7, 8, 9], 'CW_N4S', stake
    );
    assert.equal(settled.round, expectedRound);
    assert.equal(settled.roundLimitReached, expectedRound === 80);
    countedRounds.push(settled.round);
    fullRange = {
        ...fullRange,
        balance: settled.balanceAfter,
        total_spins: fullRange.total_spins + 1,
        current_round: settled.nextRound,
        cycle_wagered: settled.nextCycleWagered,
        cycle_payout: settled.nextCyclePayout,
        strategy_next_stake: settled.nextStrategyStake,
        strategy_streak_hits: settled.nextStrategyStreakHits,
        strategy_streak_metric: settled.nextStrategyStreakMetric
    };
}
assert.deepEqual(countedRounds, Array.from({ length: 80 }, (_, index) => index + 1));
assert.equal(fullRange.total_spins, 80);
assert.throws(() => getDirectionZoneRange(81), RangeError);
assert.throws(() => calculateDirectionZoneSettlement(
    fullRange, 0, [1, 2, 3, 4, 5, 6, 7, 8, 9], 'CW_N4S'
), RangeError);

// The 80th wager is accepted and marked terminal; no 81st round is started.
const finalBet = calculateDirectionZoneSettlement({
    initial_capital: 1000, balance: 1000, chip_value: 9, total_spins: 79,
    cycle_wagered: 0, cycle_payout: 0, strategy_next_stake: 72,
    strategy_streak_hits: 0, strategy_streak_metric: ''
}, 8, [8], 'CW_N4S');
assert.equal(finalBet.round, 80);
assert.equal(finalBet.stake, 72);
assert.equal(finalBet.roundLimitReached, true);
assert.equal(finalBet.nextRound, 80);
assert.equal(finalBet.nextStrategyStake, null);

// All four direction/size combinations point to the correctly signed wheel offset.
const wheelTargets = from => {
    const index = WHEEL_INDEX[from];
    return {
        targetUnderCW: WHEEL_ORDER[(index + 4) % 37],
        targetOverCW: WHEEL_ORDER[(index + 14) % 37],
        targetUnderCCW: WHEEL_ORDER[(index - 4 + 37) % 37],
        targetOverCCW: WHEEL_ORDER[(index - 14 + 37) % 37]
    };
};
const targetsFrom13 = wheelTargets(13);
function signedWheelDistance(from, to) {
    let distance = WHEEL_INDEX[to] - WHEEL_INDEX[from];
    if (distance > 18) distance -= 37;
    if (distance < -18) distance += 37;
    return distance;
}
const directionSizeCases = [
    [4, 'CW', 'S', 'CW_N4S'],
    [14, 'CW', 'B', 'CW_N4B'],
    [-4, 'CCW', 'S', 'CCW_N4S'],
    [-14, 'CCW', 'B', 'CCW_N4B']
];
for (const [expectedDistance, direction, zone, label] of directionSizeCases) {
    const target = getDirectionZoneTarget(targetsFrom13, direction, zone);
    assert.equal(signedWheelDistance(13, target), expectedDistance);
    assert.equal(getDirectionZoneMetricLabel(expectedDistance), label);
}
assert.equal(getDirectionZoneTarget(targetsFrom13, 'CCW', 'S'), 17);
assert.equal(getDirectionZoneTarget(targetsFrom13, 'CCW', 'B'), 3);

console.log('Tracker bankroll and 80-round strategy checks passed.');
