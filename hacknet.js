const MONEYFAC = 0.5
const CACHEMONEYFAC = 0.005

const base = ["core", "level", "ram"]
const plural = stat => stat == "core" ? "cores" : stat
const upgrade_func_str = stat => stat.concat("UpgradeCost")
const mult_str = stat => "hacknet_node_".concat(stat).concat("_cost")
const upper_str = stat => stat.slice(0,1).toUpperCase().concat(stat.slice(1))
const max_func_str = stat => "Max".concat(upper_str(stat))

const seq = amount => [...Array(amount).keys()]
const getPossible = (cur, max) => seq(max-cur)

const player_stat_mult = (ns, stat) => ns.getPlayer().mults[mult_str(stat)]
const max_stat = (ns, stat) => ns.formulas.hacknetServers.constants()[max_func_str(plural(stat))]
const serv_cost_base = (ns, stat) => ns.formulas.hacknetServers[upgrade_func_str(stat)]
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

function buy_fn(ns, to_buy) {
    ns.print("Buying ", to_buy[1], " for ", to_buy[0])
    ns["hacknet"]["upgrade".concat(upper_str(to_buy[1]))](to_buy[0], to_buy[2])
}

const node_possibles = (ns, node) => possibles(ns, node, base)
const player_money = ns => ns.getPlayer().money*MONEYFAC
const reg_comp = (best, cur) => cur[4]/cur[3] > best[4]/best[3]
const best_buy = ns => general_buy(ns, node_possibles, player_money, reg_comp)

const cache_possibles = (ns, node) => possibles(ns, node, ["cache"])
const cache_money = ns => ns.getPlayer().money*CACHEMONEYFAC
const cache_comp = (best, cur) => cur[2]>best[2]
const cache_buy = ns => general_buy(ns, cache_possibles, cache_money, cache_comp)

function possibles(ns, node, stats) {
    return stats.reduce((acc, stat) => {
        let ctxt = [ns, stat]
        let node_fn = node_stats(node)
        let possible = substitution(range, [node_fn, max_stat], ctxt)
        possible = possible.map(poss => [node, stat, poss, cost_fn(node_fn, ctxt)(poss), benefit_fn(node_fn, ctxt)(poss)])
        return acc.concat(possible)
    },[])
}

function general_buy(ns, poss_fn, cost_fn, comp_fn) {
    return seq(ns.hacknet.numNodes()).reduce((best, node) => { // idx, stat, possible, cost, benefit
        let options = poss_fn(ns, node).filter(poss => poss[3] <= cost_fn(ns))
        let server_best = options.reduce((best_, purchase) => { 
            if (comp_fn(best_, purchase)) return purchase
            return best_   
        })
        if (comp_fn(best, server_best)) return server_best
        return best
    },[0, "", 0, 1, 0])
}

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL")
    while (true) {
        let canSpendOnMoney = true
        while (canSpendOnMoney)
            canSpendOnMoney = ns.hacknet.spendHashes("Sell for Money")

        while (ns.hacknet.getPurchaseNodeCost() < ns.getPlayer().money * MONEYFAC) {
            ns.hacknet.purchaseNode()
            ns.tprint("Purchased a node!")
        }

        let buys = [cache_buy(ns), best_buy(ns)].filter(buy => buy[2] > 0).map(buy => buy_fn(ns, buy))
        await ns.sleep(10000)
    }
}
