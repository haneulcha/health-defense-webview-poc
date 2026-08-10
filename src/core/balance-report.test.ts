import { writeFileSync } from 'node:fs'
import { describe, it } from 'vitest'
import { Sim, STEP_SECONDS, upgradeCost } from './sim'
import { isBuildable, PATH_CELLS } from './path'
import { GRID_COLS, GRID_ROWS, TILE } from '../render/layout'
import { TOWERS, type TowerDef } from '../content/towers'
import { WAVES } from '../content/waves'

/**
 * Balance instrument, not an assertion.
 *
 * Runs a scripted player across difficulty multipliers and strategies and
 * writes the outcome grid to `docs/balance-report.txt`. Tuning wave numbers by
 * playing by hand is slow and unrepeatable; this makes the whole difficulty
 * surface visible in under a second, which is how the current curve was found.
 *
 * It lives as a `.test.ts` so `npm test` keeps it compiling as the sim changes.
 * It asserts nothing — `campaign.test.ts` holds the assertions.
 */

const REPORT_PATH = 'docs/balance-report.txt'

/** Multipliers applied on top of each wave's authored `hpScale`. */
const DIFFICULTIES = [0.7, 0.85, 1, 1.2]

/** Board size at which the scripted player switches from expanding to upgrading. */
const STRATEGIES = [12, 16, 20, 28, 40]

function bestCellFor(sim: Sim, def: TowerDef): { col: number; row: number } | null {
  let best: { col: number; row: number } | null = null
  let bestCoverage = 0
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      if (!isBuildable(col, row) || sim.towerAt(col, row)) continue
      const x = col * TILE + TILE / 2
      const y = row * TILE + TILE / 2
      let coverage = 0
      for (const cell of PATH_CELLS) {
        const [pc, pr] = cell.split(',').map(Number) as [number, number]
        if (Math.hypot(pc * TILE + TILE / 2 - x, pr * TILE + TILE / 2 - y) <= def.range) {
          coverage++
        }
      }
      if (coverage > bestCoverage) {
        bestCoverage = coverage
        best = { col, row }
      }
    }
  }
  return bestCoverage > 0 ? best : null
}

/**
 * Buys the strongest thing it can afford: more towers until the board is
 * `wideEnough`, then upgrades the weakest tower. Sweeping `wideEnough` is what
 * reveals whether going tall or wide is the better line.
 */
export function spendGreedily(sim: Sim, wideEnough: number): void {
  if (sim.towers.length >= wideEnough) {
    const target = sim.towers
      .filter((tower) => {
        const cost = upgradeCost(tower)
        return cost !== null && cost <= sim.willpower
      })
      .sort((a, b) => a.level - b.level)[0]
    if (target && sim.upgradeTower(target.col, target.row)) return
  }

  const affordable = sim
    .availableTowers()
    .map((id) => TOWERS[id] as TowerDef)
    .filter((def) => def.cost <= sim.willpower)
    .sort((a, b) => b.cost - a.cost)
  for (const def of affordable) {
    const cell = bestCellFor(sim, def)
    if (cell && sim.placeTower(cell.col, cell.row, def.id)) return
  }
}

function runBot(wideEnough: number): string {
  const sim = new Sim({ seed: 2026 })
  const perWave: string[] = []
  let lastWave = 0
  let lastHealth = sim.coreHealth

  for (let i = 0; i < Math.round(900 / STEP_SECONDS) && !sim.isOver; i++) {
    if (i % 30 === 0) spendGreedily(sim, wideEnough)
    sim.step()
    if (sim.waves.waveIndex !== lastWave) {
      const lost = lastHealth - sim.coreHealth
      perWave.push(`w${lastWave + 1}${lost > 0 ? `-${lost}` : ''}`)
      lastWave = sim.waves.waveIndex
      lastHealth = sim.coreHealth
    }
  }

  return (
    `${sim.phase} hp=${sim.coreHealth} towers=${sim.towers.length} ` +
    `${Math.round(sim.elapsed)}s | ${perWave.join(' ')}`
  )
}

describe('balance report', () => {
  it('writes the difficulty-by-strategy grid', () => {
    const authored = WAVES.map((wave) => wave.hpScale)
    const lines = [
      '# difficulty (hpScale multiplier) x strategy (towers built before upgrading)',
      '# wN-X means wave N cost X health',
      '# regenerate: npx vitest run src/core/balance-report.test.ts',
      '',
    ]

    for (const difficulty of DIFFICULTIES) {
      for (const wide of STRATEGIES) {
        WAVES.forEach((wave, i) => {
          wave.hpScale = Math.round((authored[i] as number) * difficulty * 100) / 100
        })
        lines.push(`d=${difficulty} wide=${wide}: ${runBot(wide)}`)
      }
      lines.push('')
    }

    WAVES.forEach((wave, i) => (wave.hpScale = authored[i] as number))
    writeFileSync(REPORT_PATH, lines.join('\n'))
  })
})
