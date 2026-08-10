import { ENEMIES } from '../content/enemies'
import { TOWERS, type TowerDef } from '../content/towers'
import { investedValue, SELL_REFUND, upgradeCost, type Sim } from '../core/sim'
import type { Selection } from '../render/placement-overlay'

/**
 * The player-facing HUD, built from DOM in the letterbox band below the
 * playfield.
 *
 * DOM rather than Pixi text: it stays crisp at device resolution instead of
 * being rendered into the 168x312 buffer and upscaled, it costs no draw calls,
 * and buttons get real hit targets and focus behaviour for free.
 */

export interface HudCallbacks {
  onSelectTower: (towerId: string) => void
  onUpgrade: () => void
  onSell: () => void
  onStartWave: () => void
  onToggleSpeed: () => void
  onRestart: () => void
}

export class GameHud {
  readonly element: HTMLElement

  private readonly healthFill: HTMLElement
  private readonly healthText: HTMLElement
  private readonly willpower: HTMLElement
  private readonly waveLabel: HTMLElement
  private readonly message: HTMLElement
  private readonly towerRow: HTMLElement
  private readonly actionRow: HTMLElement
  private readonly startButton: HTMLButtonElement
  private readonly speedButton: HTMLButtonElement
  private readonly towerButtons = new Map<string, HTMLButtonElement>()

  constructor(
    parent: HTMLElement,
    private readonly callbacks: HudCallbacks,
  ) {
    this.element = el('div', 'hud')

    const status = el('div', 'hud-status')
    const healthBar = el('div', 'health-bar')
    this.healthFill = el('div', 'health-fill')
    healthBar.appendChild(this.healthFill)
    this.healthText = el('span', 'health-text')
    this.willpower = el('span', 'willpower')
    this.waveLabel = el('span', 'wave-label')
    this.startButton = button('시작', () => this.callbacks.onStartWave())
    this.startButton.classList.add('primary', 'compact')
    this.speedButton = button('1x', () => this.callbacks.onToggleSpeed())
    this.speedButton.classList.add('ghost', 'compact')
    status.append(
      healthBar,
      this.healthText,
      this.willpower,
      this.waveLabel,
      this.startButton,
      this.speedButton,
    )

    this.message = el('div', 'hud-message')

    this.towerRow = el('div', 'tower-row')
    for (const def of Object.values(TOWERS)) {
      const button = document.createElement('button')
      button.className = 'tower-button'
      button.type = 'button'
      button.append(
        withText(el('span', 'tower-name'), def.label),
        withText(el('span', 'tower-cost'), `${def.cost}`),
      )
      button.addEventListener('click', () => this.callbacks.onSelectTower(def.id))
      this.towerButtons.set(def.id, button)
      this.towerRow.appendChild(button)
    }

    this.actionRow = el('div', 'action-row')

    // The action row replaces the tower row rather than stacking below it: the
    // HUD band is only 96 CSS px on a short phone, and a fourth row would push
    // the buttons off-screen exactly when the player needs them.
    this.element.append(status, this.message, this.towerRow, this.actionRow)
    parent.appendChild(this.element)
  }

  update(sim: Sim, selection: Selection, speed: number): void {
    const healthRatio = Math.max(0, sim.coreHealth) / 100
    this.healthFill.style.width = `${healthRatio * 100}%`
    this.healthFill.classList.toggle('low', healthRatio <= 0.3)
    this.healthText.textContent = `${Math.max(0, sim.coreHealth)}`
    this.willpower.textContent = `의지력 ${sim.willpower}`
    this.waveLabel.textContent = `웨이브 ${Math.min(sim.waves.waveIndex + 1, sim.waves.totalWaves)}/${sim.waves.totalWaves}`

    this.message.textContent = this.messageFor(sim)
    this.updateTowerButtons(sim, selection)
    this.updateActions(sim, selection)

    this.startButton.hidden = sim.phase !== 'prepare'
    this.speedButton.textContent = `${speed}x`
  }

  /**
   * Names the enemies in the next wave instead of showing a count.
   *
   * "다음: 포화지방, 야식" tells a first-time player what is coming and, because
   * the enemies are named after real health risks, roughly what to do about it.
   * A bare "wave 7" tells them nothing.
   */
  private messageFor(sim: Sim): string {
    if (sim.phase === 'prepare') {
      const wave = sim.waves.currentWave
      const names = wave
        ? [...new Set(wave.groups.map((g) => ENEMIES[g.enemy]?.label ?? g.enemy))]
        : []
      const seconds = Math.max(0, Math.ceil(sim.waves.prepareRemaining))
      return `다음: ${names.join(', ')} · ${seconds}초`
    }
    if (sim.phase === 'wave') return `막는 중 · 남은 적 ${sim.counts().enemies}`
    return ''
  }

  private updateTowerButtons(sim: Sim, selection: Selection): void {
    const available = sim.availableTowers()
    for (const [id, button] of this.towerButtons) {
      const def = TOWERS[id] as TowerDef
      const unlocked = available.includes(id)
      button.hidden = !unlocked
      button.disabled = sim.willpower < def.cost
      button.classList.toggle(
        'selected',
        selection.kind === 'build' && selection.towerId === id,
      )
    }
  }

  private updateActions(sim: Sim, selection: Selection): void {
    this.actionRow.replaceChildren()
    const tower =
      selection.kind === 'tower' ? sim.towerAt(selection.col, selection.row) : null
    this.actionRow.hidden = !tower
    this.towerRow.hidden = Boolean(tower)
    if (!tower) return

    const cost = upgradeCost(tower)
    const label = el('span', 'action-label')
    label.textContent = `${tower.def.label} Lv${tower.level}`

    const upgrade = button(
      cost === null ? '최대 레벨' : `강화 ${cost}`,
      () => this.callbacks.onUpgrade(),
    )
    upgrade.disabled = cost === null || sim.willpower < cost

    const refund = Math.floor(investedValue(tower) * SELL_REFUND)
    const sell = button(`판매 +${refund}`, () => this.callbacks.onSell())
    sell.classList.add('ghost')

    this.actionRow.append(label, upgrade, sell)
  }
}

/** Full-screen result panel. Retrying is one tap — it is the metric we watch. */
export class ResultPanel {
  readonly element: HTMLElement
  private readonly title: HTMLElement
  private readonly detail: HTMLElement

  constructor(parent: HTMLElement, onRestart: () => void) {
    this.element = el('div', 'result')
    this.element.hidden = true
    this.title = el('h1', 'result-title')
    this.detail = el('p', 'result-detail')
    const retry = button('다시 도전', onRestart)
    retry.classList.add('primary')
    this.element.append(this.title, this.detail, retry)
    parent.appendChild(this.element)
  }

  update(sim: Sim): void {
    if (!sim.isOver) {
      this.element.hidden = true
      return
    }
    this.element.hidden = false
    const won = sim.phase === 'won'
    this.title.textContent = won ? '건강을 지켰다' : '건강이 무너졌다'
    this.detail.textContent = won
      ? `막아낸 위험 요인 ${sim.kills}개 · 남은 건강 ${sim.coreHealth}`
      : `웨이브 ${sim.waves.waveIndex + 1}에서 무너짐 · 막아낸 위험 요인 ${sim.kills}개`
  }
}

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag)
  node.className = className
  return node
}

function withText(node: HTMLElement, text: string): HTMLElement {
  node.textContent = text
  return node
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const node = document.createElement('button')
  node.type = 'button'
  node.textContent = label
  node.addEventListener('click', onClick)
  return node
}
