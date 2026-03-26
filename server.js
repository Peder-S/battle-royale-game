const express = require('express')
const http    = require('http')
const { Server } = require('socket.io')

const app    = express()
const server = http.createServer(app)
const io     = new Server(server)

app.use(express.static('public'))

// ─── Constants ───────────────────────────────────────────────────────────────
const WORLD_WIDTH          = 2000
const WORLD_HEIGHT         = 2000
const PLAYER_RADIUS        = 16
const BULLET_RADIUS        = 5
const PLAYER_SPEED         = 3.5
const BULLET_SPEED         = 12
const BULLET_DAMAGE        = 20
const DAMAGE_MULTIPLIER_STEP = 0.2
const DAMAGE_MULTIPLIER_MAX  = 1.8
const SHOOT_COOLDOWN_BASE  = 400
const SHOOT_COOLDOWN_MIN   = 80
const FIRERATE_STEP        = 80
const BULLET_RANGE_BASE    = 170
const BULLET_RANGE_STEP    = 110
const BULLET_RANGE_MAX     = 620
const KILL_HEAL            = 30
const HEALTH_CAP           = 150
const BOOST_DURATION       = 12    // ticks (0.6 s)
const BOOST_COOLDOWN       = 200   // ticks (10 s)
const BOOST_DASH_SPEED     = PLAYER_SPEED * 4.8
const BOOST_DASH_DRAG      = 0.78
const LOOT_PICKUP_RADIUS   = 34
const NUM_FIRERATE_LOOT    = 9
const NUM_RANGE_LOOT       = 6
const NUM_DAMAGE_LOOT      = 5
const TICK_RATE            = 20
const TICK_MS              = 1000 / TICK_RATE

// Bot settings
const BOT_AI_INTERVAL      = 3    // re-evaluate AI every N ticks
const BOT_CHASE_RANGE      = 700
const BOT_SHOOT_SPREAD     = 0.10 // radians inaccuracy
const BOT_BOOST_RANGE      = 200

const PLAYER_COLORS = [
  '#e74c3c','#3498db','#2ecc71','#f39c12',
  '#9b59b6','#1abc9c','#e67e22','#e91e63',
  '#00bcd4','#8bc34a','#ff5722','#607d8b'
]

const BOT_NAMES = [
  'Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot',
  'Gamma', 'Helix', 'Ion', 'Javelin', 'Kilo', 'Lancer'
]

const ZONE_PHASES = [
  { startTick: 0,    duration: 400,      targetRadius: 900, damage: 1  },
  { startTick: 400,  duration: 600,      targetRadius: 600, damage: 1  },
  { startTick: 1000, duration: 500,      targetRadius: 350, damage: 2  },
  { startTick: 1500, duration: 400,      targetRadius: 150, damage: 3  },
  { startTick: 1900, duration: 300,      targetRadius: 50,  damage: 5  },
  { startTick: 2200, duration: Infinity, targetRadius: 0,   damage: 10 }
]

// ─── Obstacle Map (randomized each round) ────────────────────────────────────
function buildObstacles() {
  const W = WORLD_WIDTH, H = WORLD_HEIGHT
  const cx = W / 2, cy = H / 2
  const obs = []
  const centerGap = 90 + Math.random() * 110
  const centerWallLength = 100 + Math.random() * 90
  const centerWallThickness = 44 + Math.random() * 24

  obs.push({ x: Math.round(cx - centerGap - centerWallLength), y: Math.round(cy - centerWallThickness / 2), w: Math.round(centerWallLength), h: Math.round(centerWallThickness) })
  obs.push({ x: Math.round(cx + centerGap), y: Math.round(cy - centerWallThickness / 2), w: Math.round(centerWallLength), h: Math.round(centerWallThickness) })
  obs.push({ x: Math.round(cx - centerWallThickness / 2), y: Math.round(cy - centerGap - centerWallLength), w: Math.round(centerWallThickness), h: Math.round(centerWallLength) })
  obs.push({ x: Math.round(cx - centerWallThickness / 2), y: Math.round(cy + centerGap), w: Math.round(centerWallThickness), h: Math.round(centerWallLength) })

  const midCount = 6 + Math.floor(Math.random() * 5)
  const midR = 270 + Math.random() * 160
  for (let i = 0; i < midCount; i++) {
    const a = (i / midCount) * Math.PI * 2 + Math.random() * 0.35
    const ox = Math.round(cx + Math.cos(a) * midR)
    const oy = Math.round(cy + Math.sin(a) * midR)
    const horiz = Math.random() > 0.45
    const w = horiz ? Math.round(80 + Math.random() * 90) : Math.round(34 + Math.random() * 36)
    const h = horiz ? Math.round(34 + Math.random() * 36) : Math.round(80 + Math.random() * 90)
    obs.push({ x: ox - w / 2 | 0, y: oy - h / 2 | 0, w, h })
  }

  const outerCount = 8 + Math.floor(Math.random() * 5)
  const outerR = 560 + Math.random() * 130
  for (let i = 0; i < outerCount; i++) {
    const a   = (i / outerCount) * Math.PI * 2 + Math.random() * 0.55
    const r   = outerR + (Math.random() - 0.5) * 200
    const ox  = Math.round(cx + Math.cos(a) * r)
    const oy  = Math.round(cy + Math.sin(a) * r)
    const horiz = Math.random() > 0.45
    const w   = horiz ? Math.round(70 + Math.random() * 110) : Math.round(26 + Math.random() * 34)
    const h   = horiz ? Math.round(26 + Math.random() * 34)  : Math.round(70 + Math.random() * 110)
    const rx = Math.max(60, Math.min(W - 60 - w, ox - w / 2 | 0))
    const ry = Math.max(60, Math.min(H - 60 - h, oy - h / 2 | 0))
    obs.push({ x: rx, y: ry, w, h })
  }

  return obs
}

let currentObstacles = buildObstacles()

// ─── Helpers ──────────────────────────────────────────────────────────────────
function clamp(v, mn, mx) { return Math.max(mn, Math.min(mx, v)) }
function dist2(ax, ay, bx, by) { const dx=ax-bx,dy=ay-by; return dx*dx+dy*dy }

function circleHitsRect(cx, cy, cr, rx, ry, rw, rh) {
  const px = clamp(cx, rx, rx + rw)
  const py = clamp(cy, ry, ry + rh)
  const dx = cx - px, dy = cy - py
  return dx*dx + dy*dy < cr*cr
}

function resolvePlayerObstacles(player) {
  for (const o of currentObstacles) {
    const px = clamp(player.x, o.x, o.x + o.w)
    const py = clamp(player.y, o.y, o.y + o.h)
    const dx = player.x - px, dy = player.y - py
    const d2 = dx*dx + dy*dy
    if (d2 < PLAYER_RADIUS * PLAYER_RADIUS) {
      const d = Math.sqrt(d2) || 0.001
      const ov = PLAYER_RADIUS - d
      player.x += dx / d * ov
      player.y += dy / d * ov
    }
  }
  player.x = clamp(player.x, PLAYER_RADIUS, WORLD_WIDTH  - PLAYER_RADIUS)
  player.y = clamp(player.y, PLAYER_RADIUS, WORLD_HEIGHT - PLAYER_RADIUS)
}

function bulletHitsObstacle(bx, by) {
  return currentObstacles.some(o => circleHitsRect(bx, by, BULLET_RADIUS + 1, o.x, o.y, o.w, o.h))
}

function posInObstacle(x, y) {
  return currentObstacles.some(o => x >= o.x && x <= o.x+o.w && y >= o.y && y <= o.y+o.h)
}

function getDesiredBotCount() {
  const humanCount = [...gameState.players.values()].filter(p => !p.isBot).length
  if (humanCount <= 1) return 3
  if (humanCount === 2) return 2
  return 1
}

function randomSpawnPos(excludedPlayers = [], zone = gameState.zone) {
  const spawnBuffer = PLAYER_RADIUS + 28
  for (let attempt = 0; attempt < 80; attempt++) {
    const x = 90 + Math.random() * (WORLD_WIDTH - 180)
    const y = 90 + Math.random() * (WORLD_HEIGHT - 180)
    if (posInObstacle(x, y)) continue
    if (zone && dist2(x, y, zone.cx, zone.cy) > Math.max(0, zone.radius - spawnBuffer) ** 2) continue
    const tooClose = excludedPlayers.some(p => dist2(x, y, p.x, p.y) < 180 * 180)
    if (!tooClose) return { x, y }
  }

  if (zone) {
    const angle = Math.random() * Math.PI * 2
    const radius = Math.max(0, zone.radius - spawnBuffer - 20) * Math.sqrt(Math.random())
    return {
      x: clamp(zone.cx + Math.cos(angle) * radius, 120, WORLD_WIDTH - 120),
      y: clamp(zone.cy + Math.sin(angle) * radius, 120, WORLD_HEIGHT - 120)
    }
  }

  return { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 }
}

function getDamageColor(multiplier) {
  if (multiplier >= 1.6) return '#ff4d6d'
  if (multiplier >= 1.4) return '#ff7a00'
  if (multiplier >= 1.2) return '#ffb000'
  return '#ffd84d'
}

function getAlivePlayers() {
  return [...gameState.players.values()].filter(p => p.alive)
}

function getHumanPlayers() {
  return [...gameState.players.values()].filter(p => !p.isBot)
}

function getAliveHumans() {
  return getHumanPlayers().filter(p => p.alive)
}

// ─── Game State ───────────────────────────────────────────────────────────────
function makeInitialZone() {
  return {
    cx: WORLD_WIDTH/2, cy: WORLD_HEIGHT/2,
    radius: 900, targetCx: WORLD_WIDTH/2, targetCy: WORLD_HEIGHT/2,
    targetRadius: 900, shrinkRate: 0, damagePerTick: 1, phase: 0
  }
}

const gameState = {
  phase: 'lobby',
  tick:  0,
  players:      new Map(),
  bullets:      new Map(),
  loot:         new Map(),
  zone:         makeInitialZone(),
  nextBulletId: 1,
  nextLootId:   1
}

function makeBlankInput() {
  return { up:false, down:false, left:false, right:false, shooting:false, boost:false, angle:0 }
}

// ─── Loot ─────────────────────────────────────────────────────────────────────
function spawnLoot() {
  gameState.loot.clear()
  const total = NUM_FIRERATE_LOOT + NUM_RANGE_LOOT + NUM_DAMAGE_LOOT
  for (let i = 0; i < total; i++) {
    let x, y, att = 0
    do {
      x = 150 + Math.random() * (WORLD_WIDTH  - 300)
      y = 150 + Math.random() * (WORLD_HEIGHT - 300)
      att++
    } while (posInObstacle(x, y) && att < 40)
    let type = 'damage'
    if (i < NUM_FIRERATE_LOOT) type = 'firerate'
    else if (i < NUM_FIRERATE_LOOT + NUM_RANGE_LOOT) type = 'range'
    const id   = gameState.nextLootId++
    gameState.loot.set(id, { id, type, x, y })
  }
}

// ─── Bot AI ───────────────────────────────────────────────────────────────────
function makeBotPlayer(botIndex, totalPlayers) {
  const pos = randomSpawnPos()
  return {
    id:                 `bot_${botIndex}`,
    name:               `BOT ${BOT_NAMES[botIndex] || (botIndex + 1)}`,
    x:                  pos.x, y: pos.y,
    angle:              0,
    health:             100,
    alive:              true,
    kills:              0,
    lastShot:           0,
    color:              PLAYER_COLORS[(botIndex + 6) % PLAYER_COLORS.length],
    shootCooldown:      SHOOT_COOLDOWN_BASE,
    bulletRange:        BULLET_RANGE_BASE,
    damageMultiplier:   1,
    damageColor:        getDamageColor(1),
    boosting:           false,
    boostEndTick:       0,
    boostCooldownUntil: 0,
    boostVx:            0,
    boostVy:            0,
    input:              makeBlankInput(),
    isBot:              true,
    wanderTarget:       null,
    botAiTick:          0
  }
}

function ensureBotRoster() {
  const desiredBots = getDesiredBotCount()
  for (const [id, player] of gameState.players) {
    if (player.isBot) {
      const botIndex = Number(id.split('_')[1])
      if (!Number.isFinite(botIndex) || botIndex >= desiredBots) gameState.players.delete(id)
    }
  }

  for (let i = 0; i < desiredBots; i++) {
    const id = `bot_${i}`
    const existing = gameState.players.get(id)
    if (existing) {
      existing.isBot = true
      existing.name = `BOT ${BOT_NAMES[i] || (i + 1)}`
      continue
    }
    const bot = makeBotPlayer(i, desiredBots)
    gameState.players.set(bot.id, bot)
  }
}

function updateBotAI(bot) {
  bot.botAiTick++
  if (bot.botAiTick % BOT_AI_INTERVAL !== 0) return

  const { zone, loot, players, tick } = gameState

  // Find nearest alive enemy
  let target = null, targetDist = Infinity
  for (const p of players.values()) {
    if (!p.alive || p.id === bot.id) continue
    const d = Math.sqrt(dist2(bot.x, bot.y, p.x, p.y))
    if (d < targetDist) { targetDist = d; target = p }
  }

  // Find nearest loot
  let nearLoot = null, nearLootDist = Infinity
  for (const item of loot.values()) {
    const d = Math.sqrt(dist2(bot.x, bot.y, item.x, item.y))
    if (d < nearLootDist) { nearLootDist = d; nearLoot = item }
  }

  // Zone danger?
  const dToCenter = Math.sqrt(dist2(bot.x, bot.y, zone.cx, zone.cy))
  const inDanger  = dToCenter > zone.radius * 0.85

  // Decide where to move
  let moveX = bot.x, moveY = bot.y

  if (inDanger) {
    // Flee toward zone center
    moveX = zone.cx
    moveY = zone.cy
  } else if (target && targetDist < BOT_CHASE_RANGE) {
    if (targetDist < bot.bulletRange * 0.7 && targetDist > 90) {
      // Good range — strafe perpendicular to enemy
      const perp = Math.atan2(target.y - bot.y, target.x - bot.x) + Math.PI * 0.5
      moveX = bot.x + Math.cos(perp) * 100
      moveY = bot.y + Math.sin(perp) * 100
    } else {
      moveX = target.x
      moveY = target.y
    }
  } else if (nearLoot && nearLootDist < 500) {
    moveX = nearLoot.x
    moveY = nearLoot.y
  } else {
    // Wander inside the zone
    if (!bot.wanderTarget ||
        Math.sqrt(dist2(bot.x, bot.y, bot.wanderTarget.x, bot.wanderTarget.y)) < 80) {
      const a = Math.random() * Math.PI * 2
      const r = Math.random() * zone.radius * 0.65
      bot.wanderTarget = {
        x: clamp(zone.cx + Math.cos(a) * r, 120, WORLD_WIDTH  - 120),
        y: clamp(zone.cy + Math.sin(a) * r, 120, WORLD_HEIGHT - 120)
      }
    }
    moveX = bot.wanderTarget.x
    moveY = bot.wanderTarget.y
  }

  // Movement keys
  const moveAngle = Math.atan2(moveY - bot.y, moveX - bot.x)
  const moveDist  = Math.sqrt(dist2(bot.x, bot.y, moveX, moveY))

  if (moveDist > 25) {
    const cos = Math.cos(moveAngle), sin = Math.sin(moveAngle)
    bot.input.right = cos >  0.35
    bot.input.left  = cos < -0.35
    bot.input.down  = sin >  0.35
    bot.input.up    = sin < -0.35
  } else {
    bot.input.right = bot.input.left = bot.input.down = bot.input.up = false
  }

  // Aim and shoot
  if (target) {
    const aimBase  = Math.atan2(target.y - bot.y, target.x - bot.x)
    const spread   = BOT_SHOOT_SPREAD * Math.min(targetDist, 500) / 500
    bot.input.angle    = aimBase + (Math.random() - 0.5) * spread * 2
    bot.input.shooting = targetDist < bot.bulletRange * 0.92
  } else {
    bot.input.angle    = moveAngle
    bot.input.shooting = false
  }

  // Boost
  bot.input.boost = !bot.boosting &&
    tick >= bot.boostCooldownUntil &&
    (inDanger || (target !== null && targetDist < BOT_BOOST_RANGE))
}

// ─── Round Management ─────────────────────────────────────────────────────────
function startCountdown() {
  if (getHumanPlayers().length === 0) {
    gameState.phase = 'lobby'
    return
  }
  ensureBotRoster()
  currentObstacles = buildObstacles()
  gameState.phase = 'countdown'
  spawnLoot()
  io.emit('mapData', { obstacles: currentObstacles })
  io.emit('roundStart', { countdown: 3 })
  setTimeout(() => {
    if (gameState.phase === 'countdown') {
      gameState.phase = 'active'
      gameState.tick  = 0
      gameState.zone  = makeInitialZone()
    }
  }, 3000)
}

function resetRound() {
  if (getHumanPlayers().length === 0) {
    gameState.phase = 'lobby'
    gameState.tick = 0
    gameState.zone = makeInitialZone()
    gameState.bullets.clear()
    gameState.loot.clear()
    for (const [id, p] of gameState.players) if (p.isBot) gameState.players.delete(id)
    return
  }
  ensureBotRoster()
  gameState.bullets.clear()
  gameState.tick = 0
  gameState.zone = makeInitialZone()

  const all = [...gameState.players.values()]
  const usedPositions = []
  all.forEach(player => {
    const pos = randomSpawnPos(usedPositions)
    usedPositions.push(pos)
    player.x                  = pos.x
    player.y                  = pos.y
    player.health             = 100
    player.alive              = true
    player.kills              = 0
    player.angle              = 0
    player.lastShot           = 0
    player.shootCooldown      = SHOOT_COOLDOWN_BASE
    player.bulletRange        = BULLET_RANGE_BASE
    player.damageMultiplier   = 1
    player.damageColor        = getDamageColor(1)
    player.boosting           = false
    player.boostEndTick       = 0
    player.boostCooldownUntil = 0
    player.boostVx            = 0
    player.boostVy            = 0
    player.input              = makeBlankInput()
    if (player.isBot) { player.wanderTarget = null; player.botAiTick = 0 }
  })

  startCountdown()
}

function checkWinCondition() {
  if (gameState.phase !== 'active') return
  const humans = getHumanPlayers()
  const aliveHumans = getAliveHumans()

  if (humans.length === 0) {
    gameState.phase = 'lobby'
    gameState.tick  = 0
    gameState.zone  = makeInitialZone()
    gameState.bullets.clear()
    gameState.loot.clear()
    for (const [id, p] of gameState.players) if (p.isBot) gameState.players.delete(id)
    return
  }

  if (aliveHumans.length === 0) {
    gameState.phase = 'ending'
    io.emit('roundEnd', {
      winnerId: null,
      winnerName: 'No human winner'
    })
    setTimeout(resetRound, 2000)
    return
  }

  const alive = getAlivePlayers()
  if (alive.length <= 1) {
    const winner = alive[0] || null
    gameState.phase = 'ending'
    io.emit('roundEnd', {
      winnerId:   winner ? winner.id   : null,
      winnerName: winner ? winner.name : 'Nobody'
    })
    setTimeout(resetRound, 5000)
  }
}

// ─── Zone Shrinking ───────────────────────────────────────────────────────────
function updateZonePhase() {
  const tick = gameState.tick
  let cur    = ZONE_PHASES[ZONE_PHASES.length - 1]
  for (let i = ZONE_PHASES.length - 1; i >= 0; i--) {
    if (tick >= ZONE_PHASES[i].startTick) { cur = ZONE_PHASES[i]; break }
  }
  const phaseIdx = ZONE_PHASES.indexOf(cur)
  const zone     = gameState.zone

  if (zone.phase !== phaseIdx) {
    zone.phase         = phaseIdx
    zone.targetRadius  = cur.targetRadius
    zone.damagePerTick = cur.damage
    const off = zone.radius * 0.4
    zone.targetCx = clamp(zone.cx + (Math.random()-.5)*off*2, 200, WORLD_WIDTH -200)
    zone.targetCy = clamp(zone.cy + (Math.random()-.5)*off*2, 200, WORLD_HEIGHT-200)
    const diff = zone.radius - zone.targetRadius
    const ticks = cur.duration === Infinity ? 400 : cur.duration
    zone.shrinkRate = diff > 0 ? diff / ticks : 0
  }

  if (zone.radius > zone.targetRadius)
    zone.radius = Math.max(zone.targetRadius, zone.radius - zone.shrinkRate)
  zone.cx += (zone.targetCx - zone.cx) * 0.005
  zone.cy += (zone.targetCy - zone.cy) * 0.005
}

// ─── Main Game Loop ───────────────────────────────────────────────────────────
setInterval(() => {
  if (gameState.phase !== 'active') return
  gameState.tick++

  const { players, bullets, loot, zone } = gameState
  const tick = gameState.tick
  const now  = Date.now()

  // 1. Update bot AI inputs
  for (const p of players.values()) {
    if (p.alive && p.isBot) updateBotAI(p)
  }

  // 2. Boost state + movement + obstacle resolution
  for (const player of players.values()) {
    if (!player.alive) continue
    const inp = player.input

    player.angle = inp.angle

    if (player.input.boost && !player.boosting && tick >= player.boostCooldownUntil) {
      player.boosting     = true
      player.boostEndTick = tick + BOOST_DURATION
      player.boostVx      = Math.cos(player.angle) * BOOST_DASH_SPEED
      player.boostVy      = Math.sin(player.angle) * BOOST_DASH_SPEED
    }
    if (player.boosting && tick >= player.boostEndTick) {
      player.boosting           = false
      player.boostCooldownUntil = tick + BOOST_COOLDOWN
      player.boostVx            = 0
      player.boostVy            = 0
    }

    let dx = 0, dy = 0
    if (inp.up)    dy -= PLAYER_SPEED
    if (inp.down)  dy += PLAYER_SPEED
    if (inp.left)  dx -= PLAYER_SPEED
    if (inp.right) dx += PLAYER_SPEED
    if (dx !== 0 && dy !== 0) { dx *= 0.7071; dy *= 0.7071 }

    if (player.boosting) {
      dx += player.boostVx
      dy += player.boostVy
      player.boostVx *= BOOST_DASH_DRAG
      player.boostVy *= BOOST_DASH_DRAG
    }

    player.x += dx
    player.y += dy

    resolvePlayerObstacles(player)
  }

  // 3. Loot pickup
  const pickR2 = LOOT_PICKUP_RADIUS * LOOT_PICKUP_RADIUS
  for (const player of players.values()) {
    if (!player.alive) continue
    for (const [lid, item] of loot) {
      if (dist2(player.x, player.y, item.x, item.y) < pickR2) {
        if (item.type === 'firerate')
          player.shootCooldown = Math.max(SHOOT_COOLDOWN_MIN, player.shootCooldown - FIRERATE_STEP)
        else if (item.type === 'range')
          player.bulletRange = Math.min(BULLET_RANGE_MAX, player.bulletRange + BULLET_RANGE_STEP)
        else {
          player.damageMultiplier = Math.min(DAMAGE_MULTIPLIER_MAX, player.damageMultiplier + DAMAGE_MULTIPLIER_STEP)
          player.damageColor = getDamageColor(player.damageMultiplier)
        }
        loot.delete(lid)
        io.emit('lootPickedUp', { id: lid, playerId: player.id, type: item.type })
      }
    }
  }

  // 4. Spawn bullets
  for (const player of players.values()) {
    if (!player.alive) continue
    if (player.input.shooting && (now - player.lastShot) > player.shootCooldown) {
      const angle  = player.angle
      const offset = PLAYER_RADIUS + BULLET_RADIUS + 2
      const bid    = gameState.nextBulletId++
      bullets.set(bid, {
        id: bid, ownerId: player.id,
        x:  player.x + Math.cos(angle) * offset,
        y:  player.y + Math.sin(angle) * offset,
        vx: Math.cos(angle) * BULLET_SPEED,
        vy: Math.sin(angle) * BULLET_SPEED,
        distanceTraveled: 0,
        maxRange: player.bulletRange,
        damage: Math.round(BULLET_DAMAGE * player.damageMultiplier),
        color: player.damageColor
      })
      player.lastShot = now
    }
  }

  // 5. Move bullets + collisions
  const hitR2 = (PLAYER_RADIUS + BULLET_RADIUS) * (PLAYER_RADIUS + BULLET_RADIUS)
  for (const [bId, b] of bullets) {
    b.x += b.vx; b.y += b.vy
    b.distanceTraveled += BULLET_SPEED

    if (b.distanceTraveled > b.maxRange ||
        b.x < 0 || b.x > WORLD_WIDTH ||
        b.y < 0 || b.y > WORLD_HEIGHT ||
        bulletHitsObstacle(b.x, b.y)) {
      bullets.delete(bId); continue
    }

    let hit = false
    for (const player of players.values()) {
      if (!player.alive || player.id === b.ownerId) continue
      if (dist2(b.x, b.y, player.x, player.y) < hitR2) {
        player.health -= b.damage
        bullets.delete(bId)
        hit = true
        if (player.health <= 0) {
          player.health = 0
          player.alive  = false
          const shooter = players.get(b.ownerId)
          if (shooter) {
            shooter.kills++
            shooter.health = Math.min(HEALTH_CAP, shooter.health + KILL_HEAL)
          }
          io.emit('playerDied', { id: player.id, killerId: b.ownerId })
        }
        break
      }
    }
    if (hit) continue
  }

  // 6. Zone damage
  for (const player of players.values()) {
    if (!player.alive) continue
    if (dist2(player.x, player.y, zone.cx, zone.cy) > zone.radius * zone.radius) {
      player.health -= zone.damagePerTick
      if (player.health <= 0) {
        player.health = 0
        player.alive  = false
        io.emit('playerDied', { id: player.id, killerId: null })
      }
    }
  }

  // 7. Shrink zone
  updateZonePhase()

  // 8. Win condition
  checkWinCondition()

  // 9. Broadcast — obstacles included every tick (small enough, avoids mapData sync issues)
  if (gameState.phase === 'active' || gameState.phase === 'ending') {
    io.emit('gameState', {
      phase: gameState.phase, tick,
      obstacles: currentObstacles,
      players: [...players.values()].map(p => ({
        id: p.id, name: p.name, x: p.x, y: p.y,
        angle: p.angle, health: p.health, alive: p.alive,
        kills: p.kills, color: p.color, isBot: !!p.isBot,
        boosting: p.boosting, shootCooldown: p.shootCooldown,
        bulletRange: p.bulletRange,
        damageMultiplier: p.damageMultiplier,
        damageColor: p.damageColor,
        boostCooldownUntil: p.boostCooldownUntil,
        boostEndTick: p.boostEndTick
      })),
      bullets: [...bullets.values()].map(b => ({ id:b.id, x:b.x, y:b.y, color:b.color })),
      loot:    [...loot.values()],
      zone: {
        cx: zone.cx, cy: zone.cy, radius: zone.radius,
        targetRadius: zone.targetRadius,
        damagePerTick: zone.damagePerTick, phase: zone.phase
      },
      aliveCount: getAlivePlayers().length,
      totalCount: players.size
    })
  }
}, TICK_MS)

// ─── Socket Handlers ──────────────────────────────────────────────────────────
io.on('connection', socket => {
  console.log(`[+] ${socket.id} connected`)

  socket.on('join', ({ name }) => {
    ensureBotRoster()
    const all         = [...gameState.players.values()]
    const colorIdx    = all.filter(p => !p.isBot).length % PLAYER_COLORS.length
    const pos         = randomSpawnPos([...gameState.players.values()])
    const isSpectator = gameState.phase === 'active'

    const player = {
      id:                 socket.id,
      name:               (name || '').trim().slice(0, 16) || `Player ${all.length + 1}`,
      x:                  pos.x, y: pos.y,
      angle:              0,
      health:             100,
      alive:              !isSpectator,
      kills:              0,
      lastShot:           0,
      color:              PLAYER_COLORS[colorIdx],
      shootCooldown:      SHOOT_COOLDOWN_BASE,
      bulletRange:        BULLET_RANGE_BASE,
      damageMultiplier:   1,
      damageColor:        getDamageColor(1),
      boosting:           false,
      boostEndTick:       0,
      boostCooldownUntil: 0,
      boostVx:            0,
      boostVy:            0,
      input:              makeBlankInput(),
      isBot:              false
    }
    gameState.players.set(socket.id, player)

    socket.emit('joined', {
      id: socket.id, color: player.color, spectating: isSpectator,
      worldWidth: WORLD_WIDTH, worldHeight: WORLD_HEIGHT
    })
    // Also send obstacles immediately so they're ready before first gameState arrives
    socket.emit('mapData', { obstacles: currentObstacles })

    console.log(`  "${player.name}" joined (${gameState.players.size} total, phase: ${gameState.phase})`)

    if (gameState.phase === 'lobby') startCountdown()
  })

  socket.on('input', data => {
    const player = gameState.players.get(socket.id)
    if (!player || !player.alive) return
    player.input = {
      up: !!data.up, down: !!data.down, left: !!data.left, right: !!data.right,
      shooting: !!data.shooting, boost: !!data.boost,
      angle: Number(data.angle) || 0
    }
  })

  socket.on('ping', ({ t }) => socket.emit('pong', { t }))

  socket.on('disconnect', () => {
    const player = gameState.players.get(socket.id)
    if (player) console.log(`[-] "${player.name}" disconnected`)
    gameState.players.delete(socket.id)
    for (const [id, b] of gameState.bullets) {
      if (b.ownerId === socket.id) gameState.bullets.delete(id)
    }

    // If no humans left, return to lobby (bots stay for next human)
    const humans = [...gameState.players.values()].filter(p => !p.isBot)
    if (humans.length === 0) {
      gameState.phase = 'lobby'
      gameState.tick  = 0
      gameState.zone  = makeInitialZone()
      currentObstacles = buildObstacles()
      gameState.bullets.clear()
      gameState.loot.clear()
      for (const [id, p] of gameState.players) if (p.isBot) gameState.players.delete(id)
      return
    }

    checkWinCondition()
  })
})

// ─── Start ────────────────────────────────────────────────────────────────────
ensureBotRoster()

server.listen(3001, '0.0.0.0', () => {
  console.log('Battle Royale running on http://0.0.0.0:3001')
})
