const POCKETS_PER_BET = 9;
const HIT_RETURN_MULTIPLIER = 4;
const DOUBLING_EVERY_ROUNDS = 2;

function money(value) {
    return Number(Number(value).toFixed(2));
}

function getStake(chipValue, round) {
    if (!Number.isFinite(chipValue) || chipValue <= 0 || !Number.isInteger(round) || round < 1) {
        throw new RangeError('Valor de ficha y ronda inválidos.');
    }
    return money(chipValue * POCKETS_PER_BET * 2 ** Math.floor((round - 1) / DOUBLING_EVERY_ROUNDS));
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
    getStake,
    calculateSettlement,
    getSessionOutcome
};
