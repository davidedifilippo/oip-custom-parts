// Two-Axis Pick & Place: a cantilever 2-DOF Cartesian manipulator with a horizontal X slide arm,
// a vertical Z pneumatic/electric twin-rod lift at the arm tip, and a vacuum suction gripper with
// workpiece detection.
//
// Supports three PLC control modes ('mode' param):
//  - DIGITAL (default): driven by boolean 'Move X' (false = home 0, true = strokeX), 'Move Z'
//    (false = up 0, true = strokeZ) and 'Grab' (vacuum grip), reporting 'Moving X', 'Moving Z'
//    and 'Detected' (workpiece sensed at or held by the suction cup).
//  - ANALOG: driven by REAL 'Target X' (0..strokeX m) and 'Target Z' (0..strokeZ m) setpoints plus
//    'Grab', reporting 'Actual X', 'Actual Z', 'Moving X', 'Moving Z' and 'Detected'.
//  - BISTABLE: driven by 'X+' / 'X-' and 'Z+' / 'Z-' jog/directional inputs plus 'Grab'.

const MIN_MOVING_SEC = 0.06 // minimum busy window so PLC edge/level checks never miss a transition

let curX = 0
let curZ = 0
let velX = 0
let velZ = 0
let tgtX = 0
let tgtZ = 0
let prevTgtX = 0
let prevTgtZ = 0
let busyX = 0
let busyZ = 0
let manualX = false
let manualZ = false
let manualGrab = false
let lastParamX = false
let lastParamZ = false
let lastParamGrab = false
let useStep = 0

function stepAxis(cur, vel, tgt, maxSpeed, accel, dt, approach) {
  const dist = tgt - cur
  const ad = Math.abs(dist)
  if (ad <= 1e-5) {
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
  joints: ['x', 'z'],
  grippers: ['gripper'],
  lamps: ['moveXLamp', 'movingXLamp', 'moveZLamp', 'movingZLamp', 'grabLamp', 'detectedLamp'],
  params: {
    strokeX: {
      type: 'number',
      default: 1.2,
      min: 0.3,
      max: 2.5,
      step: 0.05,
      unit: 'm',
      group: 'Size',
      label: 'Horizontal stroke X',
      desc: 'Maximum forward extension of the horizontal X arm from its home pick position (0 m) to the place position.',
    },
    strokeZ: {
      type: 'number',
      default: 0.55,
      min: 0.1,
      max: 1.5,
      step: 0.05,
      unit: 'm',
      group: 'Size',
      label: 'Vertical stroke Z',
      desc: 'Maximum downward travel of the vertical Z lift from its raised rest height.',
    },
    mountHeight: {
      type: 'number',
      default: 1.45,
      min: 0.8,
      max: 2.5,
      step: 0.05,
      unit: 'm',
      group: 'Size',
      label: 'Clearance height',
      desc: 'Height of the suction cup above the floor when Z is fully raised (0 m). At the 1.45 m default and 0.55 m Z stroke, the cup lowers to 0.90 m (suiting a 0.80 m conveyor).',
    },
    speedX: {
      type: 'number',
      default: 0.8,
      min: 0.1,
      max: 4.0,
      step: 0.05,
      unit: 'm/s',
      group: 'Motion',
      label: 'Speed X',
      desc: 'Top horizontal travel speed along the X axis.',
    },
    speedZ: {
      type: 'number',
      default: 0.6,
      min: 0.1,
      max: 3.0,
      step: 0.05,
      unit: 'm/s',
      group: 'Motion',
      label: 'Speed Z',
      desc: 'Top vertical travel speed along the Z lift axis.',
    },
    accel: {
      type: 'number',
      default: 4.0,
      min: 0.5,
      max: 20.0,
      step: 0.5,
      unit: 'm/s²',
      group: 'Motion',
      label: 'Acceleration',
      desc: 'Acceleration and braking rate for both linear axes.',
    },
    manualMoveX: {
      type: 'boolean',
      default: false,
      group: 'Start state',
      label: 'Move X (extend)',
      desc: 'Resting or manual command for the X axis when no PLC program drives it.',
    },
    manualMoveZ: {
      type: 'boolean',
      default: false,
      group: 'Start state',
      label: 'Move Z (lower)',
      desc: 'Resting or manual command for the Z axis when no PLC program drives it.',
    },
    manualGrab: {
      type: 'boolean',
      default: false,
      group: 'Start state',
      label: 'Grab (vacuum on)',
      desc: 'Resting or manual command for the vacuum suction gripper when no PLC program drives it.',
    },
    enableComms: {
      type: 'boolean',
      default: false,
      group: 'Comms',
      label: 'Enable comms',
      desc: 'Connect this Two-Axis Pick & Place manipulator to the PLC controller.',
    },
    mode: {
      type: 'enum',
      default: 'digital',
      group: 'Comms',
      label: 'Control mode',
      desc: 'Digital: Move X and Move Z boolean commands drive between 0 and full stroke. Analog: Target X and Target Z REAL tags position each axis continuously in metres. Bistable: separate X+/X- and Z+/Z- tags jog or drive each direction.',
      options: [
        { value: 'digital', label: 'Digital (Move X / Move Z)' },
        { value: 'analog', label: 'Analog Position (Target X / Target Z)' },
        { value: 'bistable', label: 'Bistable (X+ / X- / Z+ / Z-)' },
      ],
    },
    moveXTag: {
      type: 'tag',
      dir: 'in',
      stType: 'BOOL',
      autoWhenDriven: true,
      default: '',
      group: 'Comms',
      visibleWhen: { param: 'mode', is: 'digital' },
      label: 'Move X tag (true = extend X)',
      desc: 'Digital command for the horizontal X axis: false retracts to home (0 m), true extends to strokeX.',
    },
    moveZTag: {
      type: 'tag',
      dir: 'in',
      stType: 'BOOL',
      autoWhenDriven: true,
      default: '',
      group: 'Comms',
      visibleWhen: { param: 'mode', is: 'digital' },
      label: 'Move Z tag (true = lower Z)',
      desc: 'Digital command for the vertical Z axis: false raises to top (0 m), true lowers to strokeZ.',
    },
    moveXPosTag: {
      type: 'tag',
      dir: 'in',
      stType: 'BOOL',
      autoWhenDriven: true,
      default: '',
      group: 'Comms',
      visibleWhen: { param: 'mode', is: 'bistable' },
      label: 'Move X+ tag (extend)',
      desc: 'Drive the horizontal X axis forward toward strokeX while true.',
    },
    moveXNegTag: {
      type: 'tag',
      dir: 'in',
      stType: 'BOOL',
      autoWhenDriven: true,
      default: '',
      group: 'Comms',
      visibleWhen: { param: 'mode', is: 'bistable' },
      label: 'Move X- tag (retract)',
      desc: 'Drive the horizontal X axis backward toward 0 m while true.',
    },
    moveZPosTag: {
      type: 'tag',
      dir: 'in',
      stType: 'BOOL',
      autoWhenDriven: true,
      default: '',
      group: 'Comms',
      visibleWhen: { param: 'mode', is: 'bistable' },
      label: 'Move Z+ tag (lower)',
      desc: 'Drive the vertical Z axis downward toward strokeZ while true.',
    },
    moveZNegTag: {
      type: 'tag',
      dir: 'in',
      stType: 'BOOL',
      autoWhenDriven: true,
      default: '',
      group: 'Comms',
      visibleWhen: { param: 'mode', is: 'bistable' },
      label: 'Move Z- tag (raise)',
      desc: 'Drive the vertical Z axis upward toward 0 m while true.',
    },
    targetXTag: {
      type: 'tag',
      dir: 'in',
      stType: 'REAL',
      default: '',
      group: 'Comms',
      visibleWhen: { param: 'mode', is: 'analog' },
      label: 'Target X tag (m)',
      desc: 'Target horizontal X position in metres (0 to strokeX).',
    },
    targetZTag: {
      type: 'tag',
      dir: 'in',
      stType: 'REAL',
      default: '',
      group: 'Comms',
      visibleWhen: { param: 'mode', is: 'analog' },
      label: 'Target Z tag (m, down)',
      desc: 'Target vertical Z lowering distance in metres (0 = up, strokeZ = full down).',
    },
    grabTag: {
      type: 'tag',
      dir: 'in',
      stType: 'BOOL',
      autoWhenDriven: true,
      default: '',
      group: 'Comms',
      label: 'Grab tag (vacuum on)',
      desc: 'Actuates the vacuum suction cup at the Z axis tip: true grabs cargo, false releases it.',
    },
    movingXTag: {
      type: 'tag',
      dir: 'out',
      stType: 'BOOL',
      default: '',
      group: 'Comms',
      label: 'Moving X tag',
      desc: 'True while the horizontal X axis is in motion toward its target.',
    },
    movingZTag: {
      type: 'tag',
      dir: 'out',
      stType: 'BOOL',
      default: '',
      group: 'Comms',
      label: 'Moving Z tag',
      desc: 'True while the vertical Z axis is in motion toward its target.',
    },
    detectedTag: {
      type: 'tag',
      dir: 'out',
      stType: 'BOOL',
      default: '',
      group: 'Comms',
      label: 'Detected tag (item at gripper)',
      desc: 'True when a workpiece is detected under the suction cup or held by the vacuum gripper.',
    },
    actualXTag: {
      type: 'tag',
      dir: 'out',
      stType: 'REAL',
      default: '',
      group: 'Comms/Feedback',
      label: 'Actual X tag (m)',
      desc: 'Current horizontal X axis position in metres.',
    },
    actualZTag: {
      type: 'tag',
      dir: 'out',
      stType: 'REAL',
      default: '',
      group: 'Comms/Feedback',
      label: 'Actual Z tag (m)',
      desc: 'Current vertical Z axis position in metres.',
    },
    atHomeXTag: {
      type: 'tag',
      dir: 'out',
      stType: 'BOOL',
      default: '',
      group: 'Comms/Feedback',
      label: 'At Home X tag (x = 0)',
      desc: 'Limit switch feedback: true when the X axis is fully retracted at 0 m.',
    },
    atEndXTag: {
      type: 'tag',
      dir: 'out',
      stType: 'BOOL',
      default: '',
      group: 'Comms/Feedback',
      label: 'At Extended X tag (x = strokeX)',
      desc: 'Limit switch feedback: true when the X axis has reached full strokeX.',
    },
    atTopZTag: {
      type: 'tag',
      dir: 'out',
      stType: 'BOOL',
      default: '',
      group: 'Comms/Feedback',
      label: 'At Top Z tag (z = 0)',
      desc: 'Limit switch feedback: true when the Z axis is fully raised at 0 m.',
    },
    atBottomZTag: {
      type: 'tag',
      dir: 'out',
      stType: 'BOOL',
      default: '',
      group: 'Comms/Feedback',
      label: 'At Bottom Z tag (z = strokeZ)',
      desc: 'Limit switch feedback: true when the Z axis is fully lowered at strokeZ.',
    },
  },
  init(ctx) {
    const P = ctx.params
    manualX = P.manualMoveX === true
    manualZ = P.manualMoveZ === true
    manualGrab = P.manualGrab === true
    lastParamX = manualX
    lastParamZ = manualZ
    lastParamGrab = manualGrab
    curX = manualX ? P.strokeX : 0
    curZ = manualZ ? P.strokeZ : 0
    tgtX = curX
    tgtZ = curZ
    prevTgtX = tgtX
    prevTgtZ = tgtZ
    velX = 0
    velZ = 0
    busyX = 0
    busyZ = 0
    useStep = 0
  },
  step(ctx) {
    const P = ctx.params
    const strokeX = Math.max(0.1, P.strokeX)
    const strokeZ = Math.max(0.05, P.strokeZ)
    const speedX = Math.max(0.05, P.speedX)
    const speedZ = Math.max(0.05, P.speedZ)
    const accel = Math.max(0.2, P.accel)

    // Adopt Inspector toggle changes when edited
    if (P.manualMoveX !== lastParamX) {
      lastParamX = P.manualMoveX
      manualX = P.manualMoveX
    }
    if (P.manualMoveZ !== lastParamZ) {
      lastParamZ = P.manualMoveZ
      manualZ = P.manualMoveZ
    }
    if (P.manualGrab !== lastParamGrab) {
      lastParamGrab = P.manualGrab
      manualGrab = P.manualGrab
    }

    // Pilot / editor 'Use' cycles through a demo pick-and-place sequence when not PLC-driven
    if (ctx.used()) {
      useStep = (useStep + 1) % 6
      if (useStep === 1) { manualZ = true }
      else if (useStep === 2) { manualGrab = true; manualZ = false }
      else if (useStep === 3) { manualX = true }
      else if (useStep === 4) { manualZ = true }
      else if (useStep === 5) { manualGrab = false; manualZ = false }
      else { manualX = false; manualZ = false; manualGrab = false }
    }

    let cmdMoveX = manualX
    let cmdMoveZ = manualZ
    let cmdGrab = manualGrab

    if (P.enableComms) {
      if (ctx.tagDriven(P.grabTag)) {
        cmdGrab = ctx.readTag(P.grabTag)
        manualGrab = cmdGrab
      }

      if (P.mode === 'analog') {
        const rx = P.targetXTag ? ctx.readNumber(P.targetXTag) : 0
        const rz = P.targetZTag ? ctx.readNumber(P.targetZTag) : 0
        tgtX = ctx.clamp(rx, 0, strokeX)
        tgtZ = ctx.clamp(rz, 0, strokeZ)
        cmdMoveX = tgtX > 0.01
        cmdMoveZ = tgtZ > 0.01
      } else if (P.mode === 'bistable') {
        const xp = ctx.tagDriven(P.moveXPosTag) && ctx.readTag(P.moveXPosTag)
        const xn = ctx.tagDriven(P.moveXNegTag) && ctx.readTag(P.moveXNegTag)
        const zp = ctx.tagDriven(P.moveZPosTag) && ctx.readTag(P.moveZPosTag)
        const zn = ctx.tagDriven(P.moveZNegTag) && ctx.readTag(P.moveZNegTag)
        if (xp && !xn) tgtX = strokeX
        else if (xn && !xp) tgtX = 0
        else tgtX = curX
        if (zp && !zn) tgtZ = strokeZ
        else if (zn && !zp) tgtZ = 0
        else tgtZ = curZ
        cmdMoveX = xp || xn
        cmdMoveZ = zp || zn
      } else {
        // Default: Digital ('Move X', 'Move Z')
        if (ctx.tagDriven(P.moveXTag)) {
          cmdMoveX = ctx.readTag(P.moveXTag)
          manualX = cmdMoveX
        }
        if (ctx.tagDriven(P.moveZTag)) {
          cmdMoveZ = ctx.readTag(P.moveZTag)
          manualZ = cmdMoveZ
        }
        tgtX = cmdMoveX ? strokeX : 0
        tgtZ = cmdMoveZ ? strokeZ : 0
      }
    } else {
      tgtX = cmdMoveX ? strokeX : 0
      tgtZ = cmdMoveZ ? strokeZ : 0
    }

    if (Math.abs(tgtX - prevTgtX) > 1e-4) {
      busyX = MIN_MOVING_SEC
      prevTgtX = tgtX
    }
    if (Math.abs(tgtZ - prevTgtZ) > 1e-4) {
      busyZ = MIN_MOVING_SEC
      prevTgtZ = tgtZ
    }

    const sx = stepAxis(curX, velX, tgtX, speedX, accel, ctx.dt, ctx.approach)
    const sz = stepAxis(curZ, velZ, tgtZ, speedZ, accel, ctx.dt, ctx.approach)
    curX = ctx.clamp(sx.pos, 0, strokeX)
    velX = sx.vel
    curZ = ctx.clamp(sz.pos, 0, strokeZ)
    velZ = sz.vel

    if (busyX > 0) busyX = Math.max(0, busyX - ctx.dt)
    if (busyZ > 0) busyZ = Math.max(0, busyZ - ctx.dt)

    const movingX = sx.moving || busyX > 0
    const movingZ = sz.moving || busyZ > 0

    ctx.joints.x = curX
    ctx.joints.z = curZ
    ctx.grips.gripper = cmdGrab

    const beamHit = ctx.sense('sensorEye')
    const holding = Boolean(ctx.measured && ctx.measured.grips && ctx.measured.grips.gripper)
    const detected = holding || (beamHit && beamHit.hit && beamHit.distance <= 0.12)

    ctx.lamps.moveXLamp = cmdMoveX
    ctx.lamps.movingXLamp = movingX
    ctx.lamps.moveZLamp = cmdMoveZ
    ctx.lamps.movingZLamp = movingZ
    ctx.lamps.grabLamp = cmdGrab
    ctx.lamps.detectedLamp = detected

    ctx.display('xDisplay', movingX ? 'Moving X' : (cmdMoveX ? 'Move X: ON' : 'Move X: OFF'))
    ctx.display('zDisplay', movingZ ? 'Moving Z' : (cmdMoveZ ? 'Move Z: ON' : 'Move Z: OFF'))

    if (P.enableComms) {
      if (P.movingXTag) ctx.writeTag(P.movingXTag, movingX)
      if (P.movingZTag) ctx.writeTag(P.movingZTag, movingZ)
      if (P.detectedTag) ctx.writeTag(P.detectedTag, detected)
      if (P.actualXTag) ctx.writeNumber(P.actualXTag, curX)
      if (P.actualZTag) ctx.writeNumber(P.actualZTag, curZ)
      if (P.atHomeXTag) ctx.writeTag(P.atHomeXTag, curX <= 1e-3 && !movingX)
      if (P.atEndXTag) ctx.writeTag(P.atEndXTag, Math.abs(curX - strokeX) <= 1e-3 && !movingX)
      if (P.atTopZTag) ctx.writeTag(P.atTopZTag, curZ <= 1e-3 && !movingZ)
      if (P.atBottomZTag) ctx.writeTag(P.atBottomZTag, Math.abs(curZ - strokeZ) <= 1e-3 && !movingZ)
    }
  },
})
