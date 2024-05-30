import { get_target_names } from "./network-manager.js";
import { get_times, get_possible_ram } from "./future/mediator.js"

const HOME_RAM_RESERVED = 20; // 20 GB reserved
const MID_INT = 50;
const INTERVAL = 200;
const CORE_FAC = 0.003125
const WEAK_SEC_FAC = 0.05
const HACK_SEC_FAC = 0.002
const GROW_SEC_FAC = 0.004
const scripts = ["a-hack.js", "a-weaken.js", "a-grow.js", "a-weaken.js"]

let future_targets = new Map()
let assignments = new Map()

const sum = lst => lst.reduce((a, c) => a + c, 0)
const w_remed = cores => (WEAK_SEC_FAC+CORE_FAC*(cores-1))
const w_offset = fac => (actions, cores) => (actions*fac)/w_remed(cores)
const w_offset_h = w_offset(HACK_SEC_FAC)
const w_offset_g = w_offset(GROW_SEC_FAC)

function mapToObj(map){
  const obj = {}
  for (let [k,v] of map)
    obj[k] = v
  return obj
}

// Only looks at prepared servers
/** @param {NS} ns */
function get_batch(ns, target, player, cores) {
    return fraction => {
        let server = structuredClone(target)
        let person = structuredClone(player)
        let xp_mults = ns.getBitNodeMultipliers().HackExpGain * person.mults.hacking_exp
        let level_mults = ns.getBitNodeMultipliers().HackingLevelMultiplier * person.mults.hacking
        let h_percent = ns.formulas.hacking.hackPercent(server, player)
        let h_threads = Math.floor(fraction/h_percent)
        let h_amount = h_threads * h_percent * server.moneyMax
        let h_chance = ns.formulas.hacking.hackChance(server, player)
        server.moneyAvailable = Math.max(0, server.moneyAvailable-h_amount)
        server.hackDifficulty += h_threads*HACK_SEC_FAC
        person.exp.hacking += ns.formulas.hacking.hackExp(server, person) * h_threads * xp_mults
        person.skills.hacking = ns.formulas.skills.calculateSkill(person.exp.hacking, level_mults)
        let w1_threads = Math.ceil(w_offset_h(h_threads, cores))
        server.hackDifficulty = Math.max(server.minDifficulty, server.hackDifficulty-w_remed(cores)*w1_threads)
        person.exp.hacking += ns.formulas.hacking.hackExp(server, person) * w1_threads * xp_mults
        person.skills.hacking = ns.formulas.skills.calculateSkill(person.exp.hacking, level_mults)
        let g_threads = ns.formulas.hacking.growThreads(server, person, server.moneyMax, cores)
        server.moneyAvailable = Math.min(server.moneyMax, ns.formulas.hacking.growAmount(server, person, g_threads, cores))
        server.hackDifficulty += g_threads*GROW_SEC_FAC
        person.exp.hacking += ns.formulas.hacking.hackExp(server, person) * g_threads * xp_mults
        person.skills.hacking = ns.formulas.skills.calculateSkill(person.exp.hacking, level_mults)
        let w2_threads = Math.ceil(w_offset_g(g_threads, cores))
        server.hackDifficulty = Math.max(server.minDifficulty, server.hackDifficulty-w_remed(cores)*w2_threads)
        person.exp.hacking += ns.formulas.hacking.hackExp(server, person) * w2_threads * xp_mults
        person.skills.hacking = ns.formulas.skills.calculateSkill(person.exp.hacking, level_mults)
        return {threads_per_batch: [h_threads, w1_threads, g_threads, w2_threads], money_per_batch: h_amount*h_chance}
    }
}

function get_batch_ram(threads, jit=false) {
    let [h, w1, g, w2] = threads
    if (jit)
        return sum([h*1.7*(5/20), w1*1.75, g*1.75*(16/20), w2*1.75])
    return sum([h*1.7, w1*1.75, g*1.75, w2*1.75])
}

function value(total_ram, timing) {
    return batch => {
        let money = batch.money_per_batch
        let time = timing.time_per_batch
        let ram = get_batch_ram(batch.threads_per_batch)
        let max_time_batches = timing.batches_per_time
        return [money/(ram*time), Math.min(total_ram/ram, max_time_batches)]
    }
}

function max_batches_per_second(ns, server, player) {
    let weaken_time = ns.formulas.hacking.weakenTime(server, player)
    let time_per_batch = weaken_time-MID_INT*3
    let batches_per_time = Math.floor(time_per_batch/(MID_INT*4))
    return {time_per_batch: time_per_batch, batches_per_time: batches_per_time}
}

/** @param {NS} ns */
function best_frac(ns, target, player, cores, max_ram, max_batch) {
    let results = []
    for (let i = 1; i <= 10; i++) {
        let frac = i/100
        let batch = get_batch(ns, target, player, cores)(frac)
        let [mprs, batchcount] = value(max_ram, max_batch)(batch)
        results.push({threads: batch.threads_per_batch, amount: batch.money_per_batch, mprs: mprs, batchcount: batchcount, frac: frac})
    }
    return results.reduce((best, cur) => {
        if (cur.mprs > best.mprs) return cur
        else return best
    }, {threads: [0,0,0,0], amount: 0, mprs: 0, batchcount: 0, frac: 0})
}

function get_action(ns, target) {
    if ((target.hackDifficulty - target.minDifficulty)>=0.05) return "w"
    else if ((target.moneyAvailable/target.moneyMax)<0.99) return "g"
    else return "h"
}

function needed_fn(ns, max_ram) {
    return (target, player, cores) => {
        let needed = {threads: [], action: get_action(ns, target), max_threads: 0}
        if (needed.action == "w") {
            let w_threads = Math.ceil((target.hackDifficulty - target.minDifficulty)/w_remed(cores))
            needed.threads = [0,0,0,w_threads]
            needed.max_threads = w_threads
        }
        else if (needed.action == "g") {
            let g_threads = ns.formulas.hacking.growThreads(target, player, target.moneyMax, cores)
            needed.threads = [0,0,g_threads, Math.ceil(w_offset_g(g_threads, cores))]
            needed.max_threads = g_threads
        }
        else if (needed.action == "h") {
            let max_batches = max_batches_per_second(ns, target, player)
            let best = best_frac(ns, target, player, cores, max_ram, max_batches)
            needed.threads = best.threads.map(t => Math.floor(t))
            needed.max_threads = max_batches.batches_per_time
        }
        return needed
    }
}

/** @param {NS} ns */
export async function main(ns) {
    ns.clearPort(1)
    ns.clearPort(2)
    ns.rm("logfile.txt", "home")
    ns.disableLog("scan")
    ns.disableLog("getHackingLevel")
    ns.disableLog("sleep")
    ns.tprint("Starting...")

    ns.exec("hacknet.js", "home", { preventDuplicates: true })
    ns.exec("startups.js", "home", { preventDuplicates: true })
    ns.exec("startups-backdoors.js", "home", { preventDuplicates: true })
    ns.exec("status.js", "home", { preventDuplicates: true })
    ns.exec("factions.js", "home", { preventDuplicates: true })

    await ns.sleep(1000)
    let player = ns.getPlayer()
    while (true) {
        let target_names = get_target_names(ns).sort((a, b) => value(ns, b, 0.07) - value(ns, a, 0.07))
        target_names.forEach(target_name => { if (!assignments.has(target_name)) assignments.set(target_name, {name:target_name, w:0, g:0, h:0}) })
        target_names.forEach(target_name => { if (!future_targets.has(target_name)) future_targets.set(target_name, ns.getServer(target_name)) })
        for (let target_name of target_names) {
            let target = future_targets.get(target_name)
            let hack_hosts = get_possible_ram(ns, false, HOME_RAM_RESERVED).sort((a,b) => b.ram - a.ram)
            let max_ram_possible = hack_hosts.reduce((acc, cur) => acc + cur[1], 0)
            let need_fn = needed_fn(ns, max_ram_possible)

            let action = get_action(ns, target)
            let [h_time, g_time, w_time] = get_times(ns, ns.getServer(target_name), ns.getPlayer())
            let time_fac;
            if (action == "h") time_fac = 0
            else if (action == "g") time_fac = 1
            else if (action == "w") time_fac = 2
            let wait_times = [w_time - h_time - MID_INT, 0, w_time - g_time + MID_INT, 2 * MID_INT].map(time => time - MID_INT * time_fac)

            let batches = recursive_batches(ns, target, player, need_fn, hack_hosts)
            //{name: hostname, threads: hostthreads, target: target_after_host_threads, player: player_after_host_threads}
            batches.forEach((batch, idx) => {
                //future_targets.set(target_name, batch.target)
                //player = batch.player
                for (let j = 0; j < 4; j++) {
                    if (batch.threads[j] > 0) {
                        let exec_args = [scripts[j], batch.name, batch.threads[j], target_name, wait_times[j]+idx*INTERVAL, batch.threads[j], batch.action]
                        ns.write("logfile.txt",exec_args.join(";")+"\n","a")
                        let e_pid = do_execs(ns, exec_args)
                    }
                }
            })
        }
        await ns.nextPortWrite(1)
        let data = JSON.parse(ns.readPort(1))
        if (data.script == "weaken" && data.action == "w") assignments.get(data.name)[data.action] -= data.threads
        else if (data.script == "grow" && data.action == "g") assignments.get(data.name)[data.action] -= data.threads
        else if (data.script == "hack" && data.action == "h") assignments.get(data.name)[data.action] -= 1
        ns.writePort(2, JSON.stringify(mapToObj(assignments)))
    }
}

function do_execs(ns, exec_args) {
    let pid = ns.exec(...exec_args);
    if (pid == 0) {
        ns.tprint("Failed call arg dump:")
        ns.tprint(exec_args)
    }
    return pid;
} //3952 @andy-smitten him+wife $499.00

const weaken_batch = threads => [0, 0, 0, Math.ceil(threads)]
const grow_batch = cores => threads => [0, 0, Math.ceil(threads), Math.ceil(w_offset_g(Math.ceil(threads), cores))]
function hack_batch(ns, target, player, cores) {
    return threads => {
        let server = structuredClone(target)
        server.moneyAvailable *= (1 - threads * ns.formulas.hacking.hackPercent(server, player))
        let w1_threads = Math.ceil(w_offset_h(threads, cores))
        let g_threads = ns.formulas.hacking.growThreads(server, player, server.moneyMax, cores)
        let w2_threads = Math.ceil(w_offset_g(g_threads, cores))
        return [threads, w1_threads, g_threads, w2_threads]
    }
}

function max_threads(ns, min, max, ram, batch_fn) {
    if (max <= min) return batch_fn(min)
    let batch_ram = get_batch_ram(batch_fn(max))
    if (batch_ram > ram) return max_threads(ns, min, max-1, ram, batch_fn)
    return batch_fn(max)
}

function max_threads_possible(ns, target, player, ram, cores, action) {
    let threads;
    if (action == "w") {
        let ub = Math.ceil(ram/1.75)
        threads = max_threads(ns, 0, ub, ram, weaken_batch)
    } else if (action == "g") {
        let ub = Math.ceil(ram/(1.75+1.75*GROW_SEC_FAC/(WEAK_SEC_FAC+CORE_FAC*(cores-1))))
        threads = max_threads(ns, 0, ub, ram, grow_batch(cores))
    } else if (action == "h") {
        let ub = Math.ceil(ram/1.75) // We don't really have a better estimation for initial thread count
        threads = max_threads(ns, 0, ub, ram, hack_batch(ns, target, player, cores))
    }
    return threads.map(thread => Math.max(thread, 0))
}

function sim_threads(ns, server, person, cores, threads) {
    let [h_threads, w1_threads, g_threads, w2_threads] = threads
    let xp_mults = ns.getBitNodeMultipliers().HackExpGain * person.mults.hacking_exp
    let level_mults = ns.getBitNodeMultipliers().HackingLevelMultiplier * person.mults.hacking
    // H
    server.moneyAvailable *= (1 - h_threads * ns.formulas.hacking.hackPercent(server, person))
    server.hackDifficulty += h_threads*HACK_SEC_FAC
    person.exp.hacking += ns.formulas.hacking.hackExp(server, person) * h_threads * xp_mults
    person.skills.hacking = ns.formulas.skills.calculateSkill(person.exp.hacking, level_mults)
    // W1
    server.hackDifficulty = Math.max(server.minDifficulty, server.hackDifficulty-w_remed(cores)*w1_threads)
    person.exp.hacking += ns.formulas.hacking.hackExp(server, person) * w1_threads * xp_mults
    person.skills.hacking = ns.formulas.skills.calculateSkill(person.exp.hacking, level_mults)
    // G
    server.moneyAvailable = Math.min(server.moneyMax, ns.formulas.hacking.growAmount(server, person, g_threads, cores))
    server.hackDifficulty += g_threads*GROW_SEC_FAC
    person.exp.hacking += ns.formulas.hacking.hackExp(server, person) * g_threads * xp_mults
    person.skills.hacking = ns.formulas.skills.calculateSkill(person.exp.hacking, level_mults)
    // W2
    server.hackDifficulty = Math.max(server.minDifficulty, server.hackDifficulty-w_remed(cores)*w2_threads)
    person.exp.hacking += ns.formulas.hacking.hackExp(server, person) * w2_threads * xp_mults
    person.skills.hacking = ns.formulas.skills.calculateSkill(person.exp.hacking, level_mults)
    return {target: server, player: person}
}

// Returns: {name: hostname, action: action, threads: hostthreads, target: target_after_host_threads, player: player_after_host_threads}
function recursive_batches(ns, target, player, needed_fn, hack_hosts) {
    // Assigned tells us what's already running against the target
    let ret_list;
    if (hack_hosts.length == 0) 
        ret_list = []
    else {
        let [host, ...tail] = hack_hosts
        let needed = needed_fn(target, player, host.cores)
        // The only degenerate case is hacks with no more batches left. This should cover everything tho
        if (assignments.get(target.hostname)[needed.action] >= needed.max_threads)
            ret_list = []
        else {
            if (needed.action == "w")
                needed.threads = weaken_batch(needed.max_threads - assignments.get(target.hostname)[needed.action])
            else if (needed.action == "g")
                needed.threads = grow_batch(host.cores)(needed.max_threads - assignments.get(target.hostname)[needed.action])
            let needed_ram = get_batch_ram(needed.threads)
            if (host.ram >= needed_ram) {
                let sims = sim_threads(ns, target, player, host.cores, needed.threads)
                let batch = {name:host.name, action:needed.action, threads:needed.threads, target:sims.target, player:sims.player}
                if (needed.action == "w" || needed.action == "g") {
                    assignments.get(target.hostname)[needed.action] += needed.max_threads
                    ret_list = [batch]
                }
                else if (needed.action == "h") {
                    assignments.get(target.hostname)[needed.action] += 1
                    let host_remaining = host
                    host_remaining.ram = host.ram - needed_ram
                    ret_list = [batch, ...recursive_batches(ns, sims.target, sims.player, needed_fn, [host_remaining, ...tail])]
                }
            } else {
                let max_threads = max_threads_possible(ns, target, player, host.ram, host.cores, needed.action)
                if (needed.action == "w") assignments.get(target.hostname)[needed.action] += max_threads[3]
                else if (needed.action == "g") assignments.get(target.hostname)[needed.action] += max_threads[2]
                else if (needed.action == "h") assignments.get(target.hostname)[needed.action] += max_threads[0] > 0 ? 1 : 0
                let sims = sim_threads(ns, target, player, host.cores, max_threads)
                let batch = {name:host.name, action:needed.action, threads:max_threads, target:sims.target, player:sims.player}
                ret_list = [batch, ...recursive_batches(ns, sims.target, sims.player, needed_fn, tail)]
            }
        }
    }
    
    ns.writePort(2, JSON.stringify(mapToObj(assignments)))
    return ret_list
}
