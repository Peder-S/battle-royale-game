'use strict'

// ─── Constants (must match server) ───────────────────────────────────────────
const WORLD_WIDTH    = 2000
const WORLD_HEIGHT   = 2000
const PLAYER_RADIUS  = 16
const BULLET_RADIUS  = 5
const HEALTH_CAP     = 150   // max HP (overheal)
const TICK_RATE      = 20

// ─── DOM ──────────────────────────────────────────────────────────────────────
const lobbyScreen    = document.getElementById('lobby-screen')
const gameScreen     = document.getElementById('game-screen')
const canvas         = document.getElementById('game-canvas')
const ctx            = canvas.getContext('2d')
const nameInput      = document.getElementById('name-input')
const joinBtn        = document.getElementById('join-btn')

const overlaySpectate  = document.getElementById('overlay-spectate')
const overlayDead      = document.getElementById('overlay-dead')
const overlayWinner    = document.getElementById('overlay-winner')
const overlayCountdown = document.getElementById('overlay-countdown')
const countdownNumber  = document.getElementById('countdown-number')
const winnerTitle      = document.getElementById('winner-title')
const winnerNameEl     = document.getElementById('winner-name')

// ─── Client State ─────────────────────────────────────────────────────────────
const client = {
  myId:              null,
  myColor:           null,
  spectating:        false,
  isDead:            false,
  gameState:         null,
  obstacles:         [],
  camera:            { x: 0, y: 0 },
  input:             { up: false, down: false, left: false, right: false, shooting: false, boost: false, angle: 0 },
  mouseWorld:        { x: 0, y: 0 },
  ping:              0,
  playerName:        '',
  notifications:     [],   // { text, color, spawnTime }
  wasBoostingLastFrame: false,
  boostFlashTime:    0     // ms timestamp of last boost activation flash
}

// ─── Socket ───────────────────────────────────────────────────────────────────
const socket = io()

socket.on('connect', () => {
  if (client.myId !== null && client.playerName) {
    socket.emit('join', { name: client.playerName })
  }
})

socket.on('joined', ({ id, color, spectating }) => {
  client.myId       = id
  client.myColor    = color
  client.spectating = spectating
  client.isDead     = false
  client.wasBoostingLastFrame = false
  client.boostFlashTime = 0

  lobbyScreen.style.display = 'none'
  gameScreen.style.display  = 'block'

  if (spectating) showOverlay(overlaySpectate)
  else hideAllOverlays()
})

socket.on('mapData', ({ obstacles }) => {
  client.obstacles = obstacles
})

socket.on('gameState', state => {
  client.gameState = state
})

socket.on('playerDied', ({ id }) => {
  if (id === client.myId) {
    client.isDead = true
    hideAllOverlays()
    showOverlay(overlayDead)
  }
})

socket.on('roundEnd', ({ winnerId, winnerName }) => {
  winnerNameEl.textContent   = winnerName
  winnerTitle.textContent    = winnerId === client.myId ? 'YOU WIN!' : 'WINNER'
  winnerTitle.style.color    = '#f1c40f'
  hideAllOverlays()
  showOverlay(overlayWinner)
})

socket.on('roundStart', ({ countdown }) => {
  client.isDead     = false
  client.spectating = false
  client.wasBoostingLastFrame = false
  client.boostFlashTime = 0
  hideAllOverlays()
  showOverlay(overlayCountdown)

  let count = countdown
  countdownNumber.textContent = count
  const iv = setInterval(() => {
    count--
    if (count <= 0) { clearInterval(iv); hideAllOverlays() }
    else countdownNumber.textContent = count
  }, 1000)
})

socket.on('pong', ({ t }) => { client.ping = Date.now() - t })

socket.on('lootPickedUp', ({ playerId, type }) => {
  if (playerId !== client.myId) return
  if (type === 'firerate') notify('⚡ FIRE RATE UP!', '#f39c12')
  else if (type === 'range') notify('↗ RANGE UP!', '#1abc9c')
  else                       notify('✹ DAMAGE UP!', '#ff6b5f')
})

// ─── Notification System ──────────────────────────────────────────────────────
function notify(text, color = '#FFD700') {
  client.notifications.push({ text, color, spawnTime: Date.now() })
}

// ─── Overlay Helpers ──────────────────────────────────────────────────────────
function showOverlay(el) { el.style.display = 'flex' }
function hideAllOverlays() {
  overlaySpectate.style.display  = 'none'
  overlayDead.style.display      = 'none'
  overlayWinner.style.display    = 'none'
  overlayCountdown.style.display = 'none'
}

// ─── Input Handling ───────────────────────────────────────────────────────────
window.addEventListener('keydown', e => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault()
  if (e.code === 'KeyW' || e.code === 'ArrowUp')                  client.input.up       = true
  if (e.code === 'KeyS' || e.code === 'ArrowDown')                client.input.down     = true
  if (e.code === 'KeyA' || e.code === 'ArrowLeft')                client.input.left     = true
  if (e.code === 'KeyD' || e.code === 'ArrowRight')               client.input.right    = true
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight')          client.input.boost    = true
})
window.addEventListener('keyup', e => {
  if (e.code === 'KeyW' || e.code === 'ArrowUp')                  client.input.up       = false
  if (e.code === 'KeyS' || e.code === 'ArrowDown')                client.input.down     = false
  if (e.code === 'KeyA' || e.code === 'ArrowLeft')                client.input.left     = false
  if (e.code === 'KeyD' || e.code === 'ArrowRight')               client.input.right    = false
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight')          client.input.boost    = false
})

canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect()
  client.mouseWorld.x = e.clientX - rect.left + client.camera.x
  client.mouseWorld.y = e.clientY - rect.top  + client.camera.y
  updateAimAngle()
})
canvas.addEventListener('mousedown', e => { if (e.button === 0) client.input.shooting = true  })
canvas.addEventListener('mouseup',   e => { if (e.button === 0) client.input.shooting = false })
canvas.addEventListener('contextmenu', e => e.preventDefault())
canvas.addEventListener('wheel',       e => e.preventDefault(), { passive: false })

function updateAimAngle() {
  const state = client.gameState
  if (!state) return
  const me = state.players.find(p => p.id === client.myId)
  if (!me) return
  client.input.angle = Math.atan2(client.mouseWorld.y - me.y, client.mouseWorld.x - me.x)
}

// ─── Canvas Resize ────────────────────────────────────────────────────────────
function resizeCanvas() {
  canvas.width  = window.innerWidth
  canvas.height = window.innerHeight
}
window.addEventListener('resize', resizeCanvas)
resizeCanvas()

// ─── Lobby Join ───────────────────────────────────────────────────────────────
joinBtn.addEventListener('click', () => {
  const name = nameInput.value.trim() || 'Player'
  client.playerName = name
  socket.emit('join', { name })
})
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') joinBtn.click() })

// ─── Camera ───────────────────────────────────────────────────────────────────
function updateCamera(me) {
  const tx = me.x - canvas.width  / 2
  const ty = me.y - canvas.height / 2
  client.camera.x = Math.max(0, Math.min(WORLD_WIDTH  - canvas.width,  tx))
  client.camera.y = Math.max(0, Math.min(WORLD_HEIGHT - canvas.height, ty))
}

// ─── Rendering Helpers ────────────────────────────────────────────────────────
function healthColor(hp) {
  if (hp > 100) return '#f1c40f'  // gold = overheal
  if (hp > 60)  return '#2ecc71'
  if (hp > 30)  return '#f39c12'
  return '#e74c3c'
}

// ─── World Drawing ────────────────────────────────────────────────────────────
function drawBackground() {
  ctx.fillStyle = '#111122'
  ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT)

  ctx.strokeStyle = '#1a1a30'
  ctx.lineWidth   = 1
  for (let x = 0; x <= WORLD_WIDTH; x += 100) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_HEIGHT); ctx.stroke()
  }
  for (let y = 0; y <= WORLD_HEIGHT; y += 100) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD_WIDTH, y); ctx.stroke()
  }

  ctx.strokeStyle = '#e74c3c'
  ctx.lineWidth   = 4
  ctx.strokeRect(2, 2, WORLD_WIDTH - 4, WORLD_HEIGHT - 4)
}

function drawObstacles() {
  for (const obs of client.obstacles) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)'
    ctx.fillRect(obs.x + 8, obs.y + 8, obs.w, obs.h)

    const grad = ctx.createLinearGradient(obs.x, obs.y, obs.x, obs.y + obs.h)
    grad.addColorStop(0, '#6b718f')
    grad.addColorStop(1, '#3c415a')
    ctx.fillStyle = grad
    ctx.fillRect(obs.x, obs.y, obs.w, obs.h)

    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)'
    ctx.fillRect(obs.x + 4, obs.y + 4, obs.w - 8, obs.h - 8)

    ctx.strokeStyle = '#b8bfd8'
    ctx.lineWidth   = 2
    ctx.strokeRect(obs.x + 1, obs.y + 1, obs.w - 2, obs.h - 2)

    ctx.strokeStyle = 'rgba(255, 196, 0, 0.35)'
    ctx.lineWidth   = 3
    ctx.beginPath()
    if (obs.w >= obs.h) {
      const stripes = Math.max(2, Math.floor(obs.w / 42))
      for (let i = 0; i < stripes; i++) {
        const sx = obs.x + 12 + i * ((obs.w - 24) / Math.max(1, stripes - 1))
        ctx.moveTo(sx - 10, obs.y + obs.h - 8)
        ctx.lineTo(sx + 10, obs.y + 8)
      }
    } else {
      const stripes = Math.max(2, Math.floor(obs.h / 42))
      for (let i = 0; i < stripes; i++) {
        const sy = obs.y + 12 + i * ((obs.h - 24) / Math.max(1, stripes - 1))
        ctx.moveTo(obs.x + 8, sy - 10)
        ctx.lineTo(obs.x + obs.w - 8, sy + 10)
      }
    }
    ctx.stroke()
  }
}

function drawZone(zone) {
  if (!zone) return
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT)
  ctx.arc(zone.cx, zone.cy, zone.radius, 0, Math.PI * 2, true)
  ctx.fillStyle = 'rgba(0, 20, 120, 0.30)'
  ctx.fill('evenodd')

  ctx.beginPath()
  ctx.arc(zone.cx, zone.cy, zone.radius, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(100, 160, 255, 0.85)'
  ctx.lineWidth   = 3
  ctx.stroke()

  if (zone.targetRadius < zone.radius && zone.targetRadius > 0) {
    ctx.beginPath()
    ctx.arc(zone.cx, zone.cy, zone.targetRadius, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(100, 160, 255, 0.25)'
    ctx.lineWidth   = 1.5
    ctx.setLineDash([8, 8])
    ctx.stroke()
    ctx.setLineDash([])
  }
  ctx.restore()
}

function drawLoot(loot) {
  if (!loot) return
  const t = Date.now() / 1000
  for (const item of loot) {
    const pulse = 0.8 + 0.2 * Math.sin(t * 3 + item.id)
    const r     = 13 * pulse
    ctx.save()
    ctx.translate(item.x, item.y)

    ctx.strokeStyle = item.type === 'firerate' ? 'rgba(255, 167, 38, 0.22)' : 'rgba(0, 229, 204, 0.22)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(0, -40 - r)
    ctx.lineTo(0, -8 - r)
    ctx.stroke()

    if (item.type === 'firerate') {
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2)
      grad.addColorStop(0, 'rgba(255,165,0,0.5)')
      grad.addColorStop(1, 'rgba(255,165,0,0)')
      ctx.beginPath()
      ctx.arc(0, 0, r * 2, 0, Math.PI * 2)
      ctx.fillStyle = grad
      ctx.fill()

      // Core circle
      ctx.beginPath()
      ctx.arc(0, 0, r, 0, Math.PI * 2)
      ctx.fillStyle = '#e67e22'
      ctx.fill()
      ctx.strokeStyle = '#FFD700'
      ctx.lineWidth = 2
      ctx.stroke()

      // Lightning bolt symbol
      ctx.fillStyle = '#fff'
      ctx.font = `bold ${Math.round(r * 1.3)}px monospace`
      ctx.textAlign    = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('⚡', 0, 1)

      ctx.fillStyle = '#ffd27d'
      ctx.font = 'bold 9px monospace'
      ctx.fillText('RPM', 0, -20 - r)
    } else if (item.type === 'range') {
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2)
      grad.addColorStop(0, 'rgba(26,188,156,0.5)')
      grad.addColorStop(1, 'rgba(26,188,156,0)')
      ctx.beginPath()
      ctx.arc(0, 0, r * 2, 0, Math.PI * 2)
      ctx.fillStyle = grad
      ctx.fill()

      // Core circle
      ctx.beginPath()
      ctx.arc(0, 0, r, 0, Math.PI * 2)
      ctx.fillStyle = '#1abc9c'
      ctx.fill()
      ctx.strokeStyle = '#00e5cc'
      ctx.lineWidth = 2
      ctx.stroke()

      // Arrow symbol
      ctx.fillStyle = '#fff'
      ctx.font = `bold ${Math.round(r * 1.3)}px monospace`
      ctx.textAlign    = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('↗', 0, 1)

      ctx.fillStyle = '#9ff6ea'
      ctx.font = 'bold 9px monospace'
      ctx.fillText('RNG', 0, -20 - r)
    } else {
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.2)
      grad.addColorStop(0, 'rgba(255,82,82,0.55)')
      grad.addColorStop(1, 'rgba(255,82,82,0)')
      ctx.beginPath()
      ctx.arc(0, 0, r * 2.2, 0, Math.PI * 2)
      ctx.fillStyle = grad
      ctx.fill()

      ctx.beginPath()
      ctx.arc(0, 0, r, 0, Math.PI * 2)
      ctx.fillStyle = '#ff5a4f'
      ctx.fill()
      ctx.strokeStyle = '#ffd1cc'
      ctx.lineWidth = 2
      ctx.stroke()

      ctx.fillStyle = '#fff'
      ctx.font = `bold ${Math.round(r * 1.1)}px monospace`
      ctx.textAlign    = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('✹', 0, 1)

      ctx.fillStyle = '#ffc0ba'
      ctx.font = 'bold 9px monospace'
      ctx.fillText('DMG', 0, -20 - r)
    }
    ctx.restore()
  }
}

function drawBullets(bullets) {
  if (!bullets) return
  for (const b of bullets) {
    ctx.beginPath()
    ctx.arc(b.x, b.y, BULLET_RADIUS, 0, Math.PI * 2)
    ctx.fillStyle = b.color || '#FFD700'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(b.x, b.y, BULLET_RADIUS + 2, 0, Math.PI * 2)
    ctx.fillStyle = b.color ? `${b.color}33` : 'rgba(255,215,0,0.2)'
    ctx.fill()
  }
}

function drawHealthBar(player) {
  const barW = 44, barH = 4
  const barX = player.x - barW / 2
  const barY = player.y - PLAYER_RADIUS - 22

  ctx.fillStyle = '#111'
  ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2)
  ctx.fillStyle = '#2a2a2a'
  ctx.fillRect(barX, barY, barW, barH)

  // Normal health: 0–100 fills the full bar width
  const hp      = Math.max(0, player.health)
  const normalW = barW * Math.min(hp, 100) / 100
  ctx.fillStyle = healthColor(Math.min(hp, 100))
  ctx.fillRect(barX, barY, normalW, barH)

  // Overheal: > 100 HP shown as gold pulsing extension on the right
  if (hp > 100) {
    const ohFrac  = (hp - 100) / 50    // 0 at 100hp, 1 at 150hp
    const ohW     = barW * ohFrac * 0.4 // max extra 40% of bar width
    ctx.fillStyle = '#f1c40f'
    ctx.fillRect(barX + normalW, barY, ohW, barH)
  }
}

function drawPlayer(player, isMe) {
  // Boost speed trail (drawn before rotate so lines point backward from aim)
  if (player.boosting) {
    ctx.save()
    ctx.translate(player.x, player.y)
    ctx.rotate(player.angle)
    // Speed lines trailing behind
    ctx.strokeStyle = 'rgba(255, 180, 0, 0.55)'
    ctx.lineWidth   = 2
    ctx.lineCap     = 'round'
    for (let i = 0; i < 5; i++) {
      const spread = (i - 2) * 7   // fan spread
      const len    = 18 + (i % 3) * 8
      ctx.beginPath()
      ctx.moveTo(-PLAYER_RADIUS - 2, spread)
      ctx.lineTo(-PLAYER_RADIUS - 2 - len, spread)
      ctx.stroke()
    }
    ctx.restore()
  }

  ctx.save()
  ctx.translate(player.x, player.y)

  // Boost glow ring
  if (player.boosting) {
    const t = Date.now() / 180
    ctx.beginPath()
    ctx.arc(0, 0, PLAYER_RADIUS + 7 + Math.sin(t) * 3, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(255, 200, 0, ${0.7 + 0.25 * Math.sin(t)})`
    ctx.lineWidth   = 3
    ctx.stroke()
  }

  ctx.rotate(player.angle)

  // Body circle
  ctx.beginPath()
  ctx.arc(0, 0, PLAYER_RADIUS, 0, Math.PI * 2)
  ctx.fillStyle   = isMe ? '#ffffff' : player.color
  ctx.fill()
  ctx.strokeStyle = player.damageColor || (isMe ? player.color : 'rgba(0,0,0,0.8)')
  ctx.lineWidth   = 2.5
  ctx.stroke()

  if (player.damageMultiplier > 1) {
    ctx.beginPath()
    ctx.arc(0, 0, PLAYER_RADIUS + 5, 0, Math.PI * 2)
    ctx.strokeStyle = `${player.damageColor || '#ffb000'}88`
    ctx.lineWidth   = 2
    ctx.stroke()
  }

  // Gun barrel
  ctx.fillStyle = '#444'
  ctx.fillRect(PLAYER_RADIUS - 2, -3, 12, 6)

  ctx.restore()

  // Name tag (unrotated)
  ctx.fillStyle    = isMe ? '#ffffff' : '#cccccc'
  ctx.font         = '11px monospace'
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'bottom'
  const nameLabel = player.isBot && !player.name.startsWith('BOT ') ? `[BOT] ${player.name}` : player.name
  ctx.fillText(nameLabel, player.x, player.y - PLAYER_RADIUS - 24)

  drawHealthBar(player)
}

// ─── HUD ──────────────────────────────────────────────────────────────────────
function drawHUD(state, me) {
  if (!state) return

  const pad    = 14
  const panelW = 195
  let   row    = pad + 12

  // Compute panel height dynamically
  const panelH = me ? 240 : 90
  ctx.fillStyle   = 'rgba(0,0,0,0.58)'
  ctx.fillRect(pad, pad, panelW, panelH)
  ctx.strokeStyle = '#2a2a44'
  ctx.lineWidth   = 1
  ctx.strokeRect(pad, pad, panelW, panelH)

  ctx.font         = '11px monospace'
  ctx.textAlign    = 'left'
  ctx.textBaseline = 'top'

  // ── Health ──
  if (me) {
    ctx.fillStyle = '#aaa'
    ctx.fillText('HEALTH', pad + 12, row)
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'right'
    ctx.fillText(`${Math.ceil(Math.min(me.health, 100))} / 100`, pad + panelW - 12, row)
    ctx.textAlign = 'left'
    // overheal star
    if (me.health > 100) {
      ctx.fillStyle = '#f1c40f'
      ctx.textAlign = 'right'
      ctx.fillText('★ OVERHEAL', pad + panelW - 12, row)
      ctx.textAlign = 'left'
    }
    row += 15

    const bx = pad + 12, by = row, bw = panelW - 24, bh = 10
    ctx.fillStyle = '#1a1a2e'
    ctx.fillRect(bx, by, bw, bh)
    // Normal: 0–100 HP fills the whole bar (full = full health)
    const hp100   = Math.max(0, Math.min(me.health, 100))
    const normalW = bw * hp100 / 100
    ctx.fillStyle = healthColor(hp100)
    ctx.fillRect(bx, by, normalW, bh)
    // Overheal: gold strip beyond full bar
    if (me.health > 100) {
      const ohW = bw * Math.min((me.health - 100) / 50, 1) * 0.35
      ctx.fillStyle = '#f1c40f'
      ctx.fillRect(bx + normalW, by, ohW, bh)
    }
    ctx.strokeStyle = '#555'
    ctx.lineWidth   = 1
    ctx.strokeRect(bx, by, bw, bh)
    ctx.fillStyle = me.health > 100 ? '#f1c40f' : '#fff'
    ctx.font         = '10px monospace'
    ctx.textAlign    = 'center'
    ctx.textBaseline = 'top'
    const hpLabel = me.health >= 100 ? 'FULL' : `${Math.ceil(me.health)} HP`
    ctx.fillText(hpLabel, bx + bw / 2, by + 1)
    ctx.font         = '11px monospace'
    ctx.textAlign    = 'left'
    ctx.textBaseline = 'top'
    row += 18
  }

  // ── Divider ──
  ctx.strokeStyle = '#2a2a44'
  ctx.beginPath(); ctx.moveTo(pad + 8, row); ctx.lineTo(pad + panelW - 8, row); ctx.stroke()
  row += 8

  // ── Players alive ──
  ctx.fillStyle = '#aaa'
  ctx.fillText('PLAYERS', pad + 12, row)
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'right'
  ctx.fillText(`${state.aliveCount} / ${state.totalCount}`, pad + panelW - 12, row)
  ctx.textAlign = 'left'
  row += 16

  // ── Zone ──
  const zNames = ['SAFE', 'SHRINKING', 'SHRINKING', 'SHRINKING', 'DANGER!', 'FINAL']
  ctx.fillStyle = state.zone.damagePerTick > 0 ? '#e74c3c' : '#3498db'
  ctx.fillText('ZONE   ' + (zNames[state.zone.phase] || ''), pad + 12, row)
  row += 16

  // ── Kills ──
  if (me) {
    ctx.fillStyle = '#aaa'
    ctx.fillText('KILLS', pad + 12, row)
    ctx.fillStyle = me.kills > 0 ? '#e74c3c' : '#fff'
    ctx.textAlign = 'right'
    ctx.fillText(me.kills, pad + panelW - 12, row)
    ctx.textAlign = 'left'
    row += 16

    // ── Fire rate ──
    ctx.fillStyle = '#f39c12'
    ctx.fillText('⚡ FIRE RATE', pad + 12, row)
    ctx.textAlign = 'right'
    const frLabel = me.shootCooldown <= 100 ? 'MAX' : Math.round(me.shootCooldown) + 'ms'
    ctx.fillStyle = '#fff'
    ctx.fillText(frLabel, pad + panelW - 12, row)
    ctx.textAlign = 'left'
    row += 16

    // ── Range ──
    ctx.fillStyle = '#1abc9c'
    ctx.fillText('↗ RANGE', pad + 12, row)
    ctx.textAlign = 'right'
    ctx.fillStyle = '#fff'
    ctx.fillText(Math.round(me.bulletRange) + 'px', pad + panelW - 12, row)
    ctx.textAlign = 'left'
    row += 16

    ctx.fillStyle = me.damageColor || '#ff6b5f'
    ctx.fillText('✹ DAMAGE', pad + 12, row)
    ctx.textAlign = 'right'
    ctx.fillStyle = '#fff'
    ctx.fillText(`${me.damageMultiplier.toFixed(1)}x`, pad + panelW - 12, row)
    ctx.textAlign = 'left'
    row += 16

    // ── Boost ──
    const boostCdLeft = me.boostCooldownUntil - state.tick
    let boostLabel, boostColor
    if (me.boosting) {
      const secsLeft = ((me.boostEndTick - state.tick) / TICK_RATE).toFixed(1)
      boostLabel = `DASH   ● ${secsLeft}s`
      boostColor = '#f1c40f'
    } else if (boostCdLeft > 0) {
      const secsLeft = (boostCdLeft / TICK_RATE).toFixed(1)
      boostLabel = `DASH   ○ ${secsLeft}s`
      boostColor = '#666'
    } else {
      boostLabel = 'DASH   ● READY'
      boostColor = '#2ecc71'
    }
    ctx.fillStyle = boostColor
    ctx.fillText(boostLabel, pad + 12, row)
    row += 16

    ctx.fillStyle = '#666'
    ctx.fillText('SHIFT = FORWARD DASH', pad + 12, row)
    row += 16
  }

  // ── Ping ──
  ctx.fillStyle = '#555'
  ctx.fillText('PING   ' + client.ping + 'ms', pad + 12, row)

  // ── Spectate bar ──
  if (client.isDead && me && !me.alive) {
    ctx.fillStyle    = 'rgba(231,76,60,0.12)'
    ctx.fillRect(0, canvas.height - 36, canvas.width, 36)
    ctx.fillStyle    = '#e74c3c'
    ctx.font         = '13px monospace'
    ctx.textAlign    = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('YOU DIED — SPECTATING', canvas.width / 2, canvas.height - 18)
  }
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────
function drawLeaderboard(state) {
  if (!state) return

  const sorted = [...state.players].sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1
    return b.kills - a.kills
  })

  const margin  = 14
  const panelW  = 178
  const rowH    = 17
  const visible = Math.min(sorted.length, 14)
  const panelH  = 28 + visible * rowH + 8

  const px = canvas.width - panelW - margin
  const py = margin

  ctx.fillStyle   = 'rgba(0,0,0,0.58)'
  ctx.fillRect(px, py, panelW, panelH)
  ctx.strokeStyle = '#2a2a44'
  ctx.lineWidth   = 1
  ctx.strokeRect(px, py, panelW, panelH)

  ctx.fillStyle    = '#888'
  ctx.font         = '10px monospace'
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText('LEADERBOARD', px + panelW / 2, py + 8)

  ctx.font         = '11px monospace'
  ctx.textBaseline = 'top'

  for (let i = 0; i < visible; i++) {
    const p   = sorted[i]
    const ry  = py + 24 + i * rowH
    const isMe = p.id === client.myId

    // Row highlight for self
    if (isMe) {
      ctx.fillStyle = 'rgba(255,255,255,0.06)'
      ctx.fillRect(px + 1, ry - 1, panelW - 2, rowH)
    }

    // Rank number
    ctx.fillStyle = p.alive ? '#888' : '#444'
    ctx.textAlign = 'left'
    ctx.fillText(`${i + 1}.`, px + 8, ry)

    // Color swatch
    ctx.fillStyle = p.alive ? p.color : '#333'
    ctx.fillRect(px + 26, ry + 2, 8, 8)

    // Name (truncated to fit)
    ctx.fillStyle = isMe ? '#fff' : (p.alive ? '#ccc' : '#555')
    ctx.textAlign = 'left'
    const leaderboardName = p.isBot && !p.name.startsWith('BOT ') ? `[BOT] ${p.name}` : p.name
    const displayName = leaderboardName.length > 11 ? leaderboardName.slice(0, 10) + '…' : leaderboardName
    ctx.fillText(displayName, px + 40, ry)

    // Kills
    ctx.textAlign = 'right'
    ctx.fillStyle = p.kills > 0 ? (p.alive ? '#e74c3c' : '#774') : (p.alive ? '#888' : '#444')
    ctx.fillText(p.kills + (p.kills === 1 ? ' kill' : ' kills'), px + panelW - 8, ry)

    // Dead marker
    if (!p.alive) {
      ctx.fillStyle = '#555'
      ctx.textAlign = 'right'
      ctx.fillText('✕', px + panelW - 8, ry)
      ctx.textAlign = 'left'
    }
  }
}

// ─── Minimap ──────────────────────────────────────────────────────────────────
function drawMinimap(state) {
  if (!state) return
  const size   = 140
  const margin = 14
  const mx     = canvas.width  - size - margin
  const my     = canvas.height - size - margin
  const scale  = size / Math.max(WORLD_WIDTH, WORLD_HEIGHT)

  ctx.fillStyle   = 'rgba(0,0,0,0.6)'
  ctx.fillRect(mx, my, size, size)
  ctx.strokeStyle = '#333'
  ctx.lineWidth   = 1
  ctx.strokeRect(mx, my, size, size)

  // Obstacles on minimap
  ctx.fillStyle = '#2a2a44'
  for (const obs of client.obstacles) {
    ctx.fillRect(mx + obs.x * scale, my + obs.y * scale, obs.w * scale, obs.h * scale)
  }

  // Zone circle
  if (state.zone) {
    ctx.beginPath()
    ctx.arc(mx + state.zone.cx * scale, my + state.zone.cy * scale, state.zone.radius * scale, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(100,160,255,0.7)'
    ctx.lineWidth   = 1
    ctx.stroke()
  }

  // Loot on minimap (tiny dots)
  if (state.loot) {
    for (const item of state.loot) {
      ctx.beginPath()
      ctx.arc(mx + item.x * scale, my + item.y * scale, 1.5, 0, Math.PI * 2)
      ctx.fillStyle = item.type === 'firerate' ? '#e67e22' : '#1abc9c'
      ctx.fill()
    }
  }

  // Players
  for (const p of state.players) {
    if (!p.alive) continue
    const isMe = p.id === client.myId
    ctx.beginPath()
    ctx.arc(mx + p.x * scale, my + p.y * scale, isMe ? 3.5 : 2.5, 0, Math.PI * 2)
    ctx.fillStyle = isMe ? '#ffffff' : p.color
    ctx.fill()
  }

  // Viewport rect
  const vx = mx + client.camera.x * scale
  const vy = my + client.camera.y * scale
  ctx.strokeStyle = 'rgba(255,255,255,0.2)'
  ctx.lineWidth   = 1
  ctx.strokeRect(vx, vy, canvas.width * scale, canvas.height * scale)
}

// ─── Notifications ────────────────────────────────────────────────────────────
function drawNotifications() {
  const now = Date.now()
  client.notifications = client.notifications.filter(n => now - n.spawnTime < 2500)
  for (let i = 0; i < client.notifications.length; i++) {
    const n     = client.notifications[i]
    const age   = now - n.spawnTime
    const alpha = 1 - age / 2500
    const y     = canvas.height / 2 - 80 - i * 30 - (age / 2500) * 20  // float upward

    ctx.save()
    ctx.globalAlpha  = alpha
    ctx.fillStyle    = n.color
    ctx.font         = 'bold 18px monospace'
    ctx.textAlign    = 'center'
    ctx.textBaseline = 'middle'
    // Drop shadow
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillText(n.text, canvas.width / 2 + 1, y + 1)
    ctx.fillStyle = n.color
    ctx.fillText(n.text, canvas.width / 2, y)
    ctx.restore()
  }
}

// ─── Main Render ──────────────────────────────────────────────────────────────
function render() {
  const state = client.gameState

  ctx.clearRect(0, 0, canvas.width, canvas.height)

  if (!state) {
    ctx.fillStyle    = '#0d0d1a'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle    = '#555'
    ctx.font         = '16px monospace'
    ctx.textAlign    = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('Connecting...', canvas.width / 2, canvas.height / 2)
    return
  }

  const me = state.players.find(p => p.id === client.myId)

  if (me && me.alive) {
    updateCamera(me)
    updateAimAngle()
  }

  // World-space pass
  ctx.save()
  ctx.translate(-client.camera.x, -client.camera.y)

  drawBackground()
  drawObstacles()
  drawZone(state.zone)
  drawLoot(state.loot)
  drawBullets(state.bullets)

  for (const player of state.players) {
    if (!player.alive) continue
    drawPlayer(player, player.id === client.myId)
  }

  // Range indicator for local player (faint forward arc)
  if (me && me.alive) {
    ctx.save()
    ctx.translate(me.x, me.y)
    ctx.rotate(me.angle)
    ctx.beginPath()
    ctx.arc(0, 0, me.bulletRange, -Math.PI / 4, Math.PI / 4)
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'
    ctx.lineWidth   = 1
    ctx.setLineDash([5, 7])
    ctx.stroke()
    ctx.setLineDash([])
    ctx.restore()
  }

  ctx.restore()

  // Boost activation flash (screen-space)
  if (me && me.boosting && !client.wasBoostingLastFrame) {
    client.boostFlashTime = Date.now()
  }
  client.wasBoostingLastFrame = !!(me && me.boosting)
  if (client.boostFlashTime) {
    const age = Date.now() - client.boostFlashTime
    if (age < 350) {
      ctx.fillStyle = `rgba(255, 200, 0, ${0.28 * (1 - age / 350)})`
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
  }

  // Screen-space pass
  drawHUD(state, me)
  drawLeaderboard(state)
  drawMinimap(state)
  drawNotifications()
}

// ─── Game Loop ────────────────────────────────────────────────────────────────
let lastPingSent = 0

function gameLoop() {
  requestAnimationFrame(gameLoop)

  if (client.myId) socket.emit('input', { ...client.input })

  const now = Date.now()
  if (now - lastPingSent > 2000) {
    socket.emit('ping', { t: now })
    lastPingSent = now
  }

  render()
}

gameLoop()
