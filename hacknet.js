const MONEY_PCT = { base: 1, cache: 0.05 }

const prop = base => attr => attr != "" ? base[attr] : base
const B = f => g => x => f(g(x))
const D2 = f => g => h => (x,y) => f(g(x))(h(y)) // const P = f => g => x => y => f(g(x))(g(y))
const K = x => y => x // const
const S = f => g => x => f(x)(g(x)) //const S2 = f => g => h => S(f)(S(g)(h))
const S2 = (f, g, h) => S(S(f)(g))(h)
const Sn = (f, ...fs) => x => f(...x)(...fs.map(g => g(...x)))

const seq = b => a => [...Array(b - a).keys()]
const mul = a => b => a * b
const add = a => b => a + b
const aug = update => base => Object.assign(base, update)

const plural = stat => stat == "core" ? "cores" : stat
const mult_str = stat => `hacknet_node_${stat}_cost`
const upgrade_str = stat => stat + "UpgradeCost"
const upper_str = stat => stat[0].toUpperCase() + stat.slice(1)
const max_str = stat => `Max${upper_str(stat)}`
const ram_mod = stat => item => stat == "ram" ? Math.log2(item) : item
const hash_str = "hashGainRate"
const hash_gain_args = ["level", "ramUsed", "ram", "cores"]
const ram_op_mod = stat => n => stat == "ram" ? mul(Math.pow(2, n)) : add(n)
const stat_mod = (n, update_stat) => stat => stat == update_stat ? n : 0

const hnet = ns => ns["hacknet"]
const hnet_f = ns => ns["formulas"]["hacknetServers"]
const p_mults = ns => ns.getPlayer().mults
const get_node = node => ns => ns["hacknet"]["getNodeStats"](node)
const get_constants = ns => prop(hnet_f(ns))("constants")()
const num_nodes = ns => prop(hnet(ns))("numNodes")()

const hash = (ns, stat) => args => D2(prop)(hnet_f)(K(hash_str))(ns, stat)(...args)
const hash_gain = (n, stat, node) => (ns, _) => hash_gain_args.map(S2(ram_op_mod, stat_mod(n, stat), prop(node(ns))))
const benefit = (node, n, ns, stat) => Sn(hash, hash_gain(n, stat, node))([ns, stat])

const value = D2(prop)(hnet_f)(upgrade_str)
const cost = (node, n, ns, stat) => Sn(value, D2(prop)(node)(plural), D2(prop)(K(n))(K("")), D2(prop)(p_mults)(mult_str))([ns, stat])

const obj_build = (node, ns, stat) => n => ({amount:n, cost:cost(node, n, ns, stat), benefit:benefit(node, n, ns, stat), stat:stat})
const range = (_, stat) => D2(seq)(ram_mod(stat))(ram_mod(stat))
const poss = (node, ns) => stat => Sn(range, D2(prop)(get_constants)(B(max_str)(plural)), D2(prop)(node)(plural))([ns, stat]).map(obj_build(node, ns, stat))
const isvalid = (ns, cost_fac) => current => current.cost <= MONEY_PCT[cost_fac] * ns.getServerMoneyAvailable("home") && current.amount > 0

const general_buy = (ns, stats, cost_fac, better) => seq(num_nodes(ns))(0)
    .flatMap(num => stats.flatMap(poss(get_node(num), ns)).map(aug({ node: num })).filter(isvalid(ns, cost_fac)))
        .reduce((best, cur) => better(best, cur) ? cur : best, { amount: 0, cost: 0, benefit: 1 })

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL")
    while (true) {
        while (ns["hacknet"]["purchaseNode"]() > 0)
            ns.print("Purchased a node!")
        while (ns["hacknet"]["spendHashes"]("Sell for Money")) { }
        let buys = [
            { name: "base", stats: ["core", "level", "ram"], cost_fac: "base", better: (a, b) => b.cost / b.benefit > a.cost / a.benefit },
            { name: "cache", stats: ["cache"], cost_fac: "cache", better: (a, b) => b.amount > a.amount },
        ].map(buy => general_buy(ns, buy.stats, buy.cost_fac, buy.better)).filter(buy => buy.amount > 0)
        buys.map(to_buy => ns.print(`Buying ${to_buy.stat} for ${to_buy.node}!`))
        buys.map(to_buy => ns["hacknet"][`upgrade${upper_str(to_buy.stat)}`](to_buy.node, to_buy.amount))
        await ns.sleep(50)
    }
}
