const MONEYFAC = 0.5
const CACHEMONEYFAC = 0.005

const base = ["core", "level", "ram"]
const plural = stat => stat == "core" ? "cores" : stat
const mult_str = stat => `hacknet_node_${stat}_cost`
const upper_str = stat => stat[0].toUpperCase()+stat.slice(1)
const max_func_str = stat => `Max${upper_str(stat)}`

const seq = amount => [...Array(amount).keys()]
const getPossible = (cur, max) => seq(max-cur)

const money_fn = factor => ns => ns.getPlayer().money*factor
const player_stat_mult = (ns, stat) => ns.getPlayer().mults[mult_str(stat)]
const max_stat = (ns, stat) => ns.formulas.hacknetServers.constants()[max_func_str(plural(stat))]
const serv_cost_base = (ns, stat) => ns.formulas.hacknetServers[stat+"UpgradeCost"]
const node_stats = node => (ns, stat) => ns.hacknet.getNodeStats(node)[plural(stat)]
const ram_mod = stat => item => stat == "ram" ? Math.log2(item) : item
const range = (ns, stat) => (node_fn_c, max_fn_c) => getPossible(...[node_fn_c, max_fn_c].map(ram_mod(stat)))
const new_prod = (ns, cores, level, ram) => ns.formulas.hacknetServers.hashGainRate(level, 0, ram, cores)
const cost_fn = (node_fn, ctxt) => amount => substitution(serv_cost_base, [node_fn, constant(amount), player_stat_mult], ctxt)
const benefit_fn = (node_fn, ctxt) => amount => {
    let [ns, stat] = ctxt
    let current = base.map(stat => node_fn(ns, stat))
    if (stat == "level")
        current[1] += amount
    else if (stat == "ram")
        current[2] *= Math.pow(2, amount)
    else if (stat == "core")
        current[0] += amount
    return new_prod(ns, ...current)
}

const constant = arg => (...args) => arg
const send = (fns, args) => fns.map(fn => fn(...args))
const substitution = (f, fns, args) => f(...args)(...send(fns, args))

function buy_fn(ns) {
    return to_buy => {
        ns.print(`Buying ${to_buy.stat} for ${to_buy.node}!`)
        ns["hacknet"][`upgrade${upper_str(to_buy.stat)}`](to_buy.node, to_buy.amount)
    }
}

const reg_comp = (best, cur) => cur.benefit/cur.cost > best.benefit/best.cost
const best_buy = ns => general_buy(ns, base, money_fn(MONEYFAC), reg_comp)

const cache_comp = (best, cur) => cur.amount > best.amount
const cache_buy = ns => general_buy(ns, ["cache"], money_fn(CACHEMONEYFAC), cache_comp)

function possibles(ns, node) {
    return stats => {
        return stats.map(stat => {
            let ctxt = [ns, stat]
            let node_fn = node_stats(node)
            return substitution(range, [node_fn, max_stat], ctxt).map(amount => ({
                node:node, 
                stat:stat, 
                amount:amount,
                cost:cost_fn(node_fn, ctxt)(amount), 
                benefit:benefit_fn(node_fn, ctxt)(amount),
            }))
        })
    }
}

function general_buy(ns, stats, cost_fn, comp_fn) {
    return seq(ns.hacknet.numNodes()).reduce((best, node) => { // idx, stat, possible, cost, benefit
        let options = possibles(ns, node)(stats).filter(opt => opt.cost <= cost_fn(ns))
        let server_best = options.reduce((acc, cur) => comp_fn(acc, cur) ? cur : acc, {amount:0, cost:1, benefit:0})
        return comp_fn(best, server_best) ? server_best : best
    }, {amount:0, cost:1, benefit:0})
}

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL")
    while (true) {
        while (ns.hacknet.spendHashes("Sell for Money"))

        while (ns.hacknet.purchaseNode() > 0)
            ns.tprint("Purchased a node!")

        let buys = [cache_buy(ns), best_buy(ns)].filter(buy => buy.amount > 0).map(buy_fn(ns))
        await ns.sleep(10000)
    }
}
