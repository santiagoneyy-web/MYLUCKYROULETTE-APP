const assert = require('node:assert/strict');
const {
    getStake,
    calculateSettlement,
    getSessionOutcome
} = require('./src/engine/tracker_bankroll');
const { wheelNeighbors } = require('./src/engine/analytics_snapshot');

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

console.log('Tracker bankroll strategy checks passed.');
