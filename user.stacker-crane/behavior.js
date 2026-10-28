// Stacker Crane (AS/RS Automated Warehouse Translolevator): a rail-guided high-bay warehouse stacker
// crane with three coordinated axes:
//  1. Horizontal aisle travel ('travel' joint along +X, 0..railLength m)
//  2. Vertical mast lift ('lift' joint along +Y, 0..mastHeight m, plus automatic +liftStroke pick/place raise)
//  3. Bidirectional telescopic shuttle forks ('forks' joint along ±Z, -forkStroke..+forkStroke m)
//
// Supports two PLC addressing modes ('mode' param):
//  - SLOT MODE (default, Factory I/O style): 'Target Position' (INT) selects 0 for the Home/Conveyor I/O
//    station or 1..(numCols * numRows) for a warehouse rack slot (col = (pos-1) % numCols, row = (pos-1) / numCols).
//  - ANALOG MODE: 'Target X' (REAL, m) and 'Target Y' (REAL, m) command horizontal and vertical coordinates directly.
//
// In both modes, 'Forks Left' (BOOL, -Z) and 'Forks Right' (BOOL, +Z) control the telescopic shuttle table,
// and 'Lift' (BOOL) performs the vertical pick/release stroke:
//  - Rising edge of 'Lift' (false -> true): closes the fork gripper at shelf/conveyor level and raises the carriage
//    by +liftStroke (0.10 m) so the load clears the rack beams.
//  - Falling edge of 'Lift' (true -> false): lowers the carriage back to the shelf/conveyor datum while still holding
//    the load, and releases the gripper gently once seated at the bottom of the stroke.

const MIN_BUSY_SEC = 0.06

let curX = 0
let curY = 0
let curZ = 0
let velX = 0
let velY = 0
let velZ = 0
let busyXY = 0
let busyZ = 0
let holdingLoad = false
let manualLeft = false
let manualRight = false
let manualLift = false
let lastParamLeft = false
let lastParamRight = false
let lastParamLift = false
let useCycle = 0

function stepAxis(cur, vel, tgt, maxSpeed, accel, dt, approach) {
  const dist = tgt - cur
  const ad = Math.abs(dist)
  if (ad <= 1e-4) {
    return { pos: tgt, vel: 0, moving: false }
  }
  const dir = dist > 0 ? 1 : -1
  const h = (accel * dt) / 2
  const vStop = Math.sqrt(h * h + 2 * accel * ad) - h
  const targetVel = dir * Math.min(maxSpeed, vStop)
  const nextVel = approach(vel, targetVel, accel * dt)
  let nextPos = cur + nextVel * dt
  if ((dir > 0 && nextPos >= tgt) || (dir < 0 && nextPos <= tgt)) {
    nextPos = tgt
    return { pos: nextPos, vel: 0, moving: false }
  }
  return { pos: nextPos, vel: nextVel, moving: true }
}

definePart({
  interactive: true,
  joints: ['travel', 'lift', 'forks'],
  grippers: ['forkGrip'],
  lamps: ['movingXLamp', 'movingZLamp', 'liftLamp', 'loadedLamp'],
  params: {
    railLength: {
      type: 'number',
      default: 6.5,
      min: 2.0,
      max: 20.0,
      step: 0.5,
      unit: 'm',
      group: 'Size',
      label: 'Aisle travel length X',
      desc: 'Total horizontal travel range of the stacker crane along the warehouse aisle (+X).',
    },
    mastHeight: {
      type: 'number',
      default: 4.5,
      min: 2.0,
      max: 12.0,
      step: 0.5,
      unit: 'm',
      group: 'Size',
      label: 'Mast lift height Y',
      desc: 'Maximum vertical lift travel above the home conveyor level (0.80 m).',
    },
    forkStroke: {
      type: 'number',
      default: 1.35,
      min: 0.6,
      max: 2.2,
      step: 0.05,
      unit: 'm',
      group: 'Size',
      label: 'Fork reach Z (Left/Right)',
      desc: 'Telescopic extension distance of the shuttle forks to Left (-Z) and Right (+Z).',
    },
    liftStroke: {
      type: 'number',
      default: 0.1,
      min: 0.04,
      max: 0.25,
      step: 0.01,
      unit: 'm',
      group: 'Size',
      label: 'Pick lift stroke',
      desc: 'Vertical clearance rise added when the Lift command is active (lifts the load clear of rack beams).',
    },
    numCols: {
      type: 'number',
      default: 3,
      min: 1,
      max: 12,
      step: 1,
      group: 'Rack Grid',
      label: 'Rack bays (columns)',
      desc: 'Number of horizontal bays along X in Slot Mode (Target Position 1..N).',
    },
    numRows: {
      type: 'number',
      default: 3,
      min: 1,
      max: 10,
      step: 1,
      group: 'Rack Grid',
      label: 'Rack levels (rows)',
      desc: 'Number of vertical shelf levels in Slot Mode.',
    },
    firstBayX: {
      type: 'number',
      default: 1.8,
      min: 0.5,
      max: 10.0,
      step: 0.05,
      unit: 'm',
      group: 'Rack Grid',
      label: 'First bay X offset',
      desc: 'Horizontal X distance from Home (0 m) to the centre of Rack Column 1.',
    },
    baySpacing: {
      type: 'number',
      default: 1.8,
      min: 0.8,
      max: 4.0,
      step: 0.05,
      unit: 'm',
      group: 'Rack Grid',
      label: 'Bay spacing X',
      desc: 'Centre-to-centre horizontal distance between adjacent rack bays along X.',
    },
    firstShelfLift: {
      type: 'number',
      default: 0.42,
      min: 0.0,
      max: 4.0,
      step: 0.02,
      unit: 'm',
      group: 'Rack Grid',
      label: 'Level 1 lift Y',
      desc: 'Vertical lift height above Home (0.80 m) to align with Rack Shelf Level 1 (0.42 m matches a 1.20 m shelfSpacing rack whose Level 1 slab top is at 1.22 m).',
    },
    shelfSpacing: {
      type: 'number',
      default: 1.2,
      min: 0.5,
      max: 3.0,
      step: 0.05,
      unit: 'm',
      group: 'Rack Grid',
      label: 'Shelf spacing Y',
      desc: 'Vertical pitch between consecutive rack shelf levels.',
    },
    speedX: {
      type: 'number',
      default: 1.4,
      min: 0.2,
      max: 4.0,
      step: 0.1,
      unit: 'm/s',
      group: 'Motion',
      label: 'Travel speed X',
      desc: 'Maximum horizontal travel speed along the aisle.',
    },
    speedY: {
      type: 'number',
      default: 1.0,
      min: 0.2,
      max: 3.0,
      step: 0.1,
      unit: 'm/s',
      group: 'Motion',
      label: 'Lift speed Y',
      desc: 'Maximum vertical hoist speed along the mast.',
    },
    speedZ: {
      type: 'number',
      default: 1.0,
      min: 0.2,
      max: 3.0,
      step: 0.1,
      unit: 'm/s',
      group: 'Motion',
      label: 'Fork speed Z',
      desc: 'Maximum telescopic shuttle extension/retraction speed.',
    },
    accel: {
      type: 'number',
      default: 3.5,
      min: 0.5,
      max: 15.0,
      step: 0.5,
      unit: 'm/s²',
      group: 'Motion',
      label: 'Acceleration',
      desc: 'Acceleration and deceleration rate for all crane axes.',
    },
    manualForksLeft: {
      type: 'boolean',
      default: false,
      group: 'Start state',
      label: 'Forks Left (-Z)',
      desc: 'Manual/initial state to extend forks toward the Left (-Z) loading side.',
    },
    manualForksRight: {
      type: 'boolean',
      default: false,
      group: 'Start state',
      label: 'Forks Right (+Z)',
      desc: 'Manual/initial state to extend forks toward the Right (+Z) rack side.',
    },
    manualLift: {
      type: 'boolean',
      default: false,
      group: 'Start state',
      label: 'Lift (pick/raise)',
      desc: 'Manual/initial state to raise forks by +liftStroke and grip the load.',
    },
    enableComms: {
      type: 'boolean',
      default: false,
      group: 'Comms',
      label: 'Enable comms',
      desc: 'Connect this Stacker Crane to the PLC program.',
    },
    mode: {
      type: 'enum',
      default: 'slot',
      group: 'Comms',
      label: 'Addressing mode',
      desc: 'Slot Mode: Target Position (INT) selects 0 (Home) or 1..N (Rack Slot). Analog Mode: Target X and Target Y (REAL) set axis positions in metres.',
      options: [
        { value: 'slot', label: 'Rack Slot Number (Target Position INT)' },
        { value: 'analog', label: 'Direct Coordinates (Target X / Target Y REAL)' },
      ],
    },
    targetPosTag: {
      type: 'tag',
      dir: 'in',
      stType: 'INT',
      autoWhenDriven: true,
      default: '',
      group: 'Comms',
      visibleWhen: { param: 'mode', is: 'slot' },
      label: 'Target Position tag (0=Home, 1..N=Slot)',
      desc: 'Integer rack slot command: 0 drives to the Home/Conveyor station; 1..(numCols*numRows) drives to the corresponding rack bay and shelf level.',
    },
    targetXTag: {
      type: 'tag',
      dir: 'in',
      stType: 'REAL',
      autoWhenDriven: true,
      default: '',
      group: 'Comms',
      visibleWhen: { param: 'mode', is: 'analog' },
      label: 'Target X tag (m)',
      desc: 'Horizontal travel setpoint along the aisle (0..railLength m).',
    },
    targetYTag: {
      type: 'tag',
      dir: 'in',
      stType: 'REAL',
      autoWhenDriven: true,
      default: '',
      group: 'Comms',
      visibleWhen: { param: 'mode', is: 'analog' },
      label: 'Target Y tag (m)',
      desc: 'Vertical lift setpoint above the home fork height (0..mastHeight m).',
    },
    liftTag: {
      type: 'tag',
      dir: 'in',
      stType: 'BOOL',
      autoWhenDriven: true,
      default: '',
      group: 'Comms',
      label: 'Lift tag (true = raise & grip)',
      desc: 'Raises the fork carriage by +liftStroke and grips the load on the forks; dropping it lowers the load onto the shelf/conveyor and releases it.',
    },
    forksLeftTag: {
      type: 'tag',
      dir: 'in',
      stType: 'BOOL',
      autoWhenDriven: true,
      default: '',
      group: 'Comms',
      label: 'Forks Left tag (-Z)',
      desc: 'Extend telescopic forks to the Left (-Z, loading conveyor side).',
    },
    forksRightTag: {
      type: 'tag',
      dir: 'in',
      stType: 'BOOL',
      autoWhenDriven: true,
      default: '',
      group: 'Comms',
      label: 'Forks Right tag (+Z)',
      desc: 'Extend telescopic forks to the Right (+Z, storage rack / unloading side).',
    },
    movingXTag: {
      type: 'tag',
      dir: 'out',
      stType: 'BOOL',
      default: '',
      group: 'Comms',
      label: 'Moving X/Y tag',
      desc: 'True while the crane mast or vertical lift carriage is moving toward its target.',
    },
    movingZTag: {
      type: 'tag',
      dir: 'out',
      stType: 'BOOL',
      default: '',
      group: 'Comms',
      label: 'Moving Z (Forks) tag',
      desc: 'True while the telescopic shuttle forks are extending or retracting.',
    },
    inPositionTag: {
      type: 'tag',
      dir: 'out',
      stType: 'BOOL',
      default: '',
      group: 'Comms',
      label: 'In Position tag',
      desc: 'True when both the horizontal travel and vertical lift have settled at the commanded setpoint.',
    },
    atLeftTag: {
      type: 'tag',
      dir: 'out',
      stType: 'BOOL',
      default: '',
      group: 'Comms',
      label: 'At Left tag',
      desc: 'True when the telescopic forks are fully extended Left (-Z).',
    },
    atMiddleTag: {
      type: 'tag',
      dir: 'out',
      stType: 'BOOL',
      default: '',
      group: 'Comms',
      label: 'At Middle tag',
      desc: 'True when the telescopic forks are retracted at the centre of the mast (Z = 0).',
    },
    atRightTag: {
      type: 'tag',
      dir: 'out',
      stType: 'BOOL',
      default: '',
      group: 'Comms',
      label: 'At Right tag',
      desc: 'True when the telescopic forks are fully extended Right (+Z).',
    },
    loadedTag: {
      type: 'tag',
      dir: 'out',
      stType: 'BOOL',
      default: '',
      group: 'Comms',
      label: 'Loaded / Item Detected tag',
      desc: 'True when a pallet, crate or box is detected on or held by the forks.',
    },
    actualXTag: {
      type: 'tag',
      dir: 'out',
      stType: 'REAL',
      default: '',
      group: 'Comms',
      label: 'Actual X tag (m)',
      desc: 'Live horizontal travel position along the aisle in metres.',
    },
    actualYTag: {
      type: 'tag',
      dir: 'out',
      stType: 'REAL',
      default: '',
      group: 'Comms',
      label: 'Actual Y tag (m)',
      desc: 'Live vertical lift position above home datum in metres.',
    },
    actualZTag: {
      type: 'tag',
      dir: 'out',
      stType: 'REAL',
      default: '',
      group: 'Comms',
      label: 'Actual Z tag (m)',
      desc: 'Live telescopic fork offset in metres (negative = Left, positive = Right).',
    },
  },

  step(ctx) {
    const p = ctx.params

    if (p.manualForksLeft !== lastParamLeft) {
      manualLeft = p.manualForksLeft
      lastParamLeft = p.manualForksLeft
    }
    if (p.manualForksRight !== lastParamRight) {
      manualRight = p.manualForksRight
      lastParamRight = p.manualForksRight
    }
    if (p.manualLift !== lastParamLift) {
      manualLift = p.manualLift
      lastParamLift = p.manualLift
    }

    if (ctx.used()) {
      useCycle = (useCycle + 1) % 4
      manualLeft = useCycle === 1
      manualLift = useCycle === 1 || useCycle === 2
      manualRight = useCycle === 2
    }

    // 1. Determine base X and Y setpoints
    let baseTgtX = 0
    let baseTgtY = 0
    let slotNum = 0

    if (p.enableComms) {
      if (p.mode === 'analog') {
        if (ctx.tagDriven(p.targetXTag)) {
          baseTgtX = ctx.clamp(ctx.readNumber(p.targetXTag), 0, p.railLength)
        }
        if (ctx.tagDriven(p.targetYTag)) {
          baseTgtY = ctx.clamp(ctx.readNumber(p.targetYTag), 0, p.mastHeight)
        }
      } else {
        // Slot mode: 0 = Home (0, 0), 1..N = rack grid (col, row)
        if (ctx.tagDriven(p.targetPosTag)) {
          slotNum = Math.round(ctx.readNumber(p.targetPosTag))
        }
        const cols = Math.max(1, Math.round(p.numCols))
        const rows = Math.max(1, Math.round(p.numRows))
        const maxSlot = cols * rows
        if (slotNum >= 1 && slotNum <= maxSlot) {
          const idx = slotNum - 1
          const col = idx % cols
          const row = Math.floor(idx / cols)
          baseTgtX = ctx.clamp(p.firstBayX + col * p.baySpacing, 0, p.railLength)
          baseTgtY = ctx.clamp(p.firstShelfLift + row * p.shelfSpacing, 0, p.mastHeight)
        } else {
          baseTgtX = 0
          baseTgtY = 0
        }
      }
    }

    // 2. Read Fork Left / Right and Lift commands
    let cmdLeft = manualLeft
    let cmdRight = manualRight
    let cmdLift = manualLift

    if (p.enableComms) {
      if (ctx.tagDriven(p.forksLeftTag)) cmdLeft = ctx.readTag(p.forksLeftTag)
      if (ctx.tagDriven(p.forksRightTag)) cmdRight = ctx.readTag(p.forksRightTag)
      if (ctx.tagDriven(p.liftTag)) cmdLift = ctx.readTag(p.liftTag)
    }

    const tgtZ = cmdLeft && !cmdRight ? -p.forkStroke : cmdRight && !cmdLeft ? p.forkStroke : 0
    const tgtY = ctx.clamp(baseTgtY + (cmdLift ? p.liftStroke : 0), 0, p.mastHeight + 0.25)

    // 3. Synchronize Gripper with Lift stroke:
    //    - When cmdLift is TRUE, close the gripper immediately so it lifts the load off the shelf/conveyor.
    //    - When cmdLift is FALSE, keep holding the load while curY lowers back to baseTgtY, and release only
    //      once curY settles at baseTgtY (so the load never drops from mid-air).
    if (cmdLift) {
      holdingLoad = true
    } else if (Math.abs(curY - baseTgtY) <= 0.003) {
      holdingLoad = false
    }

    // 4. Advance smooth motion profiles for X, Y, Z
    const rx = stepAxis(curX, velX, baseTgtX, p.speedX, p.accel, ctx.dt, ctx.approach)
    const ry = stepAxis(curY, velY, tgtY, p.speedY, p.accel, ctx.dt, ctx.approach)
    const rz = stepAxis(curZ, velZ, tgtZ, p.speedZ, p.accel, ctx.dt, ctx.approach)

    curX = rx.pos
    velX = rx.vel
    curY = ry.pos
    velY = ry.vel
    curZ = rz.pos
    velZ = rz.vel

    if (!cmdLift && Math.abs(curY - baseTgtY) <= 0.003) {
      holdingLoad = false
    }

    if (rx.moving || ry.moving) {
      busyXY = MIN_BUSY_SEC
    } else {
      busyXY = Math.max(0, busyXY - ctx.dt)
    }
    if (rz.moving) {
      busyZ = MIN_BUSY_SEC
    } else {
      busyZ = Math.max(0, busyZ - ctx.dt)
    }

    const movingXY = rx.moving || ry.moving || busyXY > 0
    const movingZ = rz.moving || busyZ > 0
    const inPos = !movingXY && Math.abs(curX - baseTgtX) <= 0.003 && Math.abs(curY - tgtY) <= 0.003

    const atLeft = Math.abs(curZ + p.forkStroke) <= 0.01 && !rz.moving
    const atMiddle = Math.abs(curZ) <= 0.01 && !rz.moving
    const atRight = Math.abs(curZ - p.forkStroke) <= 0.01 && !rz.moving

    const beamHit = ctx.sense('forkSensorEye')
    const detected = (beamHit !== null && beamHit !== undefined && beamHit.distance <= 0.35) || holdingLoad

    // 5. Apply joints, gripper, lamps, and display
    ctx.joints.travel = curX
    ctx.joints.lift = curY
    ctx.joints.forks = curZ
    ctx.grips.forkGrip = holdingLoad

    ctx.lamps.movingXLamp = movingXY
    ctx.lamps.movingZLamp = movingZ
    ctx.lamps.liftLamp = cmdLift
    ctx.lamps.loadedLamp = detected

    const labelStr = p.mode === 'slot' ? `POS ${slotNum} | X:${curX.toFixed(1)}` : `X:${curX.toFixed(1)} Y:${curY.toFixed(1)}`
    ctx.display('craneDisplay', labelStr)

    // 6. Publish PLC output tags
    if (p.enableComms) {
      if (p.movingXTag) ctx.writeTag(p.movingXTag, movingXY)
      if (p.movingZTag) ctx.writeTag(p.movingZTag, movingZ)
      if (p.inPositionTag) ctx.writeTag(p.inPositionTag, inPos)
      if (p.atLeftTag) ctx.writeTag(p.atLeftTag, atLeft)
      if (p.atMiddleTag) ctx.writeTag(p.atMiddleTag, atMiddle)
      if (p.atRightTag) ctx.writeTag(p.atRightTag, atRight)
      if (p.loadedTag) ctx.writeTag(p.loadedTag, detected)
      if (p.actualXTag) ctx.writeNumber(p.actualXTag, curX)
      if (p.actualYTag) ctx.writeNumber(p.actualYTag, curY)
      if (p.actualZTag) ctx.writeNumber(p.actualZTag, curZ)
    }
  },
})
