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

const r8 = (n) => (Math.abs(n) < 1e-9 ? 0 : +n.toFixed(8))

// Default geometry constants (in metres, part-local frame):
// At rest (x = 0, z = 0):
//  - The gripper suction face sits at (x = 0, y = mountHeight, z = 0) — directly over Conveyor 1 (pick point).
//  - The support column stands at x = -0.60, z = 0 (behind Conveyor 1).
//  - Extending X moves the arm and gripper along +X toward Conveyor 2 (up to +strokeX).
//  - Extending Z lowers the twin-rod lift and suction cup along -Y (downward by up to strokeZ).
const COL_X = -0.6
const ARM_Y_OFFSET = 0.36 // height of horizontal beam centre above rest suction-cup face
const Z_HOUSING_Y_OFFSET = 0.34 // Z red housing centre above rest suction-cup face
const MIN_MOVING_SEC = 0.06 // minimum busy window so PLC edge/level checks never miss a transition

// Pickup volume centred on the gripper frame (suction cup face at y = 0 in gripper frame)
const GRAB_ZONE = { size: [0.26, 0.28, 0.26], offset: [0, -0.04, 0] }

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
  manifest: {
    id: 'user.two-axis-pick-and-place',
    name: 'Two-Axis Pick & Place',
    category: 'Equipment',
    commsParam: 'enableComms',
    materials: [
      { id: 'housingRed', color: [0.68, 0.11, 0.07], metalness: 0.22, roughness: 0.42 },
      { id: 'housingRedDark', color: [0.48, 0.08, 0.05], metalness: 0.25, roughness: 0.48 },
      { id: 'aluProfile', color: [0.68, 0.71, 0.74], metalness: 0.65, roughness: 0.32 },
      { id: 'aluSlot', color: [0.16, 0.18, 0.2], metalness: 0.4, roughness: 0.6 },
      { id: 'chromeRod', color: [0.84, 0.87, 0.9], metalness: 0.85, roughness: 0.16 },
      { id: 'darkSteel', color: [0.17, 0.19, 0.22], metalness: 0.55, roughness: 0.45 },
      { id: 'rubberCup', color: [0.08, 0.09, 0.1], metalness: 0.05, roughness: 0.85 },
      { id: 'badgeWhite', color: [0.9, 0.9, 0.88], metalness: 0.05, roughness: 0.5 },
    ],
  },
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
  rig(p) {
    const H = p.mountHeight
    const SX = p.strokeX
    const SZ = p.strokeZ
    const armY = r8(H + ARM_Y_OFFSET)
    const colHeight = r8(armY - 0.14)
    const beamLen = r8(SX + 0.72)
    const beamCenterX = r8(-0.085 - beamLen / 2)
    const rodLen = r8(SZ + 0.62)
    const rodCenterY = r8(rodLen / 2 + 0.05)
    const topPlateY = r8(rodLen + 0.055)

    const links = [
      // 1. Floor Base Plate & Anchor Bolts + Vertical Support Column (at x = COL_X)
      {
        name: 'basePlate',
        finish: 'frame',
        shape: { kind: 'box', size: [0.36, 0.03, 0.36] },
        offset: [COL_X, 0.015, 0],
      },
      {
        name: 'boltFL',
        finish: 'bolt',
        collision: 'none',
        shape: { kind: 'cylinder', radius: 0.014, height: 0.02 },
        offset: [r8(COL_X + 0.14), 0.035, 0.14],
      },
      {
        name: 'boltFR',
        finish: 'bolt',
        collision: 'none',
        shape: { kind: 'cylinder', radius: 0.014, height: 0.02 },
        offset: [r8(COL_X + 0.14), 0.035, -0.14],
      },
      {
        name: 'boltBL',
        finish: 'bolt',
        collision: 'none',
        shape: { kind: 'cylinder', radius: 0.014, height: 0.02 },
        offset: [r8(COL_X - 0.14), 0.035, 0.14],
      },
      {
        name: 'boltBR',
        finish: 'bolt',
        collision: 'none',
        shape: { kind: 'cylinder', radius: 0.014, height: 0.02 },
        offset: [r8(COL_X - 0.14), 0.035, -0.14],
      },
      {
        name: 'column',
        color: [0.18, 0.2, 0.22],
        metalness: 0.55,
        roughness: 0.42,
        shape: { kind: 'box', size: [0.16, colHeight, 0.16] },
        offset: [COL_X, r8(0.03 + colHeight / 2), 0],
      },
      {
        name: 'columnCap',
        finish: 'frame',
        collision: 'none',
        shape: { kind: 'box', size: [0.22, 0.03, 0.22] },
        offset: [COL_X, r8(armY - 0.125), 0],
      },

      // 2. Static Red X-Axis Drive Housing atop the Column
      {
        name: 'xHousingBody',
        color: [0.72, 0.12, 0.08],
        metalness: 0.22,
        roughness: 0.4,
        shape: { kind: 'box', size: [0.44, 0.22, 0.36] },
        offset: [COL_X, armY, 0],
      },
      {
        name: 'xHousingTop',
        collision: 'none',
        color: [0.76, 0.14, 0.09],
        metalness: 0.22,
        roughness: 0.38,
        shape: { kind: 'box', size: [0.4, 0.04, 0.32] },
        offset: [COL_X, r8(armY + 0.13), 0],
      },
      {
        name: 'xMotorCover',
        collision: 'none',
        color: [0.66, 0.11, 0.07],
        metalness: 0.24,
        roughness: 0.42,
        shape: { kind: 'box', size: [0.16, 0.15, 0.12] },
        offset: [r8(COL_X - 0.12), r8(armY + 0.02), -0.22],
      },
      {
        name: 'xSideBadge',
        collision: 'none',
        color: [0.92, 0.92, 0.9],
        metalness: 0.05,
        roughness: 0.5,
        shape: { kind: 'box', size: [0.09, 0.07, 0.006] },
        offset: [r8(COL_X + 0.02), r8(armY - 0.01), 0.182],
      },
      {
        name: 'xCollarFront',
        collision: 'none',
        color: [0.16, 0.18, 0.2],
        metalness: 0.5,
        roughness: 0.4,
        shape: { kind: 'box', size: [0.02, 0.15, 0.15] },
        offset: [r8(COL_X + 0.225), armY, 0],
      },
      {
        name: 'xCollarBack',
        collision: 'none',
        color: [0.16, 0.18, 0.2],
        metalness: 0.5,
        roughness: 0.4,
        shape: { kind: 'box', size: [0.02, 0.15, 0.15] },
        offset: [r8(COL_X - 0.225), armY, 0],
      },
      {
        name: 'moveXLamp',
        collision: 'none',
        shape: { kind: 'cylinder', radius: 0.014, height: 0.016 },
        offset: [r8(COL_X + 0.15), r8(armY + 0.154), -0.1],
        lamps: [{ name: 'moveXLamp', emissive: [0.95, 0.95, 0.95], offColor: [0.22, 0.22, 0.22] }],
      },
      {
        name: 'movingXLamp',
        collision: 'none',
        shape: { kind: 'cylinder', radius: 0.014, height: 0.016 },
        offset: [r8(COL_X + 0.15), r8(armY + 0.154), 0.1],
        lamps: [{ name: 'movingXLamp', emissive: [0.98, 0.78, 0.08], offColor: [0.24, 0.2, 0.06] }],
      },
      {
        name: 'xLabel',
        collision: 'none',
        color: [0.98, 0.88, 0.25],
        shape: { kind: 'label', size: [0.28, 0.055], textFrom: 'xDisplay' },
        offset: [r8(COL_X + 0.222), r8(armY + 0.085), 0],
        rotation: [0, r8(Math.PI / 2), 0],
      },

      // 3. Horizontal X Carriage (slides along +X on joint 'x')
      {
        name: 'xCarriage',
        shape: { kind: 'frame' },
        offset: [0, 0, 0],
      },
      {
        name: 'xBeam',
        parent: 'xCarriage',
        collision: 'none',
        color: [0.7, 0.73, 0.76],
        metalness: 0.68,
        roughness: 0.3,
        shape: { kind: 'box', size: [beamLen, 0.11, 0.11] },
        offset: [beamCenterX, armY, 0],
      },
      {
        name: 'xBeamSlotTop',
        parent: 'xCarriage',
        collision: 'none',
        color: [0.16, 0.18, 0.2],
        metalness: 0.4,
        roughness: 0.6,
        shape: { kind: 'box', size: [beamLen, 0.006, 0.032] },
        offset: [beamCenterX, r8(armY + 0.056), 0],
      },
      {
        name: 'xBeamSlotSideL',
        parent: 'xCarriage',
        collision: 'none',
        color: [0.16, 0.18, 0.2],
        metalness: 0.4,
        roughness: 0.6,
        shape: { kind: 'box', size: [beamLen, 0.032, 0.006] },
        offset: [beamCenterX, armY, 0.056],
      },
      {
        name: 'xBeamSlotSideR',
        parent: 'xCarriage',
        collision: 'none',
        color: [0.16, 0.18, 0.2],
        metalness: 0.4,
        roughness: 0.6,
        shape: { kind: 'box', size: [beamLen, 0.032, 0.006] },
        offset: [beamCenterX, armY, -0.056],
      },
      {
        name: 'xBeamRearCap',
        parent: 'xCarriage',
        collision: 'none',
        color: [0.18, 0.2, 0.22],
        metalness: 0.5,
        roughness: 0.45,
        shape: { kind: 'box', size: [0.02, 0.12, 0.12] },
        offset: [r8(-0.085 - beamLen - 0.01), armY, 0],
      },

      // 4. Vertical Z-Axis Red Housing mounted at the front tip of xCarriage (at x = 0)
      {
        name: 'zHousingBody',
        parent: 'xCarriage',
        collision: 'none',
        color: [0.72, 0.12, 0.08],
        metalness: 0.22,
        roughness: 0.4,
        shape: { kind: 'box', size: [0.17, 0.42, 0.17] },
        offset: [0, r8(H + Z_HOUSING_Y_OFFSET), 0],
      },
      {
        name: 'zHousingCapTop',
        parent: 'xCarriage',
        collision: 'none',
        color: [0.2, 0.22, 0.25],
        metalness: 0.55,
        roughness: 0.4,
        shape: { kind: 'box', size: [0.175, 0.024, 0.175] },
        offset: [0, r8(H + Z_HOUSING_Y_OFFSET + 0.215), 0],
      },
      {
        name: 'zHousingCapBot',
        parent: 'xCarriage',
        collision: 'none',
        color: [0.2, 0.22, 0.25],
        metalness: 0.55,
        roughness: 0.4,
        shape: { kind: 'box', size: [0.175, 0.024, 0.175] },
        offset: [0, r8(H + Z_HOUSING_Y_OFFSET - 0.215), 0],
      },
      {
        name: 'moveZLamp',
        parent: 'xCarriage',
        collision: 'none',
        shape: { kind: 'cylinder', radius: 0.012, height: 0.014 },
        offset: [0.06, r8(H + Z_HOUSING_Y_OFFSET + 0.232), -0.05],
        lamps: [{ name: 'moveZLamp', emissive: [0.95, 0.95, 0.95], offColor: [0.22, 0.22, 0.22] }],
      },
      {
        name: 'movingZLamp',
        parent: 'xCarriage',
        collision: 'none',
        shape: { kind: 'cylinder', radius: 0.012, height: 0.014 },
        offset: [0.06, r8(H + Z_HOUSING_Y_OFFSET + 0.232), 0.05],
        lamps: [{ name: 'movingZLamp', emissive: [0.98, 0.78, 0.08], offColor: [0.24, 0.2, 0.06] }],
      },
      {
        name: 'zLabel',
        parent: 'xCarriage',
        collision: 'none',
        color: [0.98, 0.88, 0.25],
        shape: { kind: 'label', size: [0.22, 0.048], textFrom: 'zDisplay' },
        offset: [0.088, r8(H + Z_HOUSING_Y_OFFSET + 0.12), 0],
        rotation: [0, r8(Math.PI / 2), 0],
      },

      // 5. Vertical Sliding Z Carriage (parent: xCarriage, slides downward along -Y on joint 'z')
      {
        name: 'zCarriage',
        parent: 'xCarriage',
        shape: { kind: 'frame' },
        offset: [0, H, 0],
      },
      {
        name: 'zRodL',
        parent: 'zCarriage',
        collision: 'none',
        color: [0.84, 0.87, 0.9],
        metalness: 0.85,
        roughness: 0.16,
        shape: { kind: 'cylinder', radius: 0.013, height: rodLen },
        offset: [0.02, rodCenterY, 0.046],
      },
      {
        name: 'zRodR',
        parent: 'zCarriage',
        collision: 'none',
        color: [0.84, 0.87, 0.9],
        metalness: 0.85,
        roughness: 0.16,
        shape: { kind: 'cylinder', radius: 0.013, height: rodLen },
        offset: [0.02, rodCenterY, -0.046],
      },
      {
        name: 'zPistonRod',
        parent: 'zCarriage',
        collision: 'none',
        color: [0.76, 0.79, 0.83],
        metalness: 0.78,
        roughness: 0.22,
        shape: { kind: 'cylinder', radius: 0.016, height: r8(rodLen - 0.08) },
        offset: [-0.032, r8(rodCenterY - 0.04), 0],
      },
      {
        name: 'zTopPlate',
        parent: 'zCarriage',
        collision: 'none',
        color: [0.2, 0.22, 0.25],
        metalness: 0.55,
        roughness: 0.4,
        shape: { kind: 'box', size: [0.048, 0.024, 0.136] },
        offset: [0.02, topPlateY, 0],
      },
      {
        name: 'zTopBoltL',
        parent: 'zCarriage',
        collision: 'none',
        finish: 'bolt',
        shape: { kind: 'cylinder', radius: 0.012, height: 0.012 },
        offset: [0.02, r8(topPlateY + 0.016), 0.046],
      },
      {
        name: 'zTopBoltR',
        parent: 'zCarriage',
        collision: 'none',
        finish: 'bolt',
        shape: { kind: 'cylinder', radius: 0.012, height: 0.012 },
        offset: [0.02, r8(topPlateY + 0.016), -0.046],
      },

      // 6. Vacuum Gripper Head & Detection Sensor at the bottom of zCarriage (y = 0 in zCarriage = H at rest)
      {
        name: 'toolBlock',
        parent: 'zCarriage',
        collision: 'none',
        color: [0.72, 0.75, 0.78],
        metalness: 0.65,
        roughness: 0.32,
        shape: { kind: 'box', size: [0.13, 0.048, 0.13] },
        offset: [0, 0.048, 0],
      },
      {
        name: 'suctionNeck',
        parent: 'zCarriage',
        collision: 'none',
        finish: 'bolt',
        shape: { kind: 'cylinder', radius: 0.026, height: 0.018 },
        offset: [0, 0.018, 0],
      },
      {
        name: 'suctionCup',
        parent: 'zCarriage',
        collision: 'none',
        color: [0.1, 0.11, 0.12],
        metalness: 0.08,
        roughness: 0.85,
        shape: { kind: 'cylinder', radius: 0.052, height: 0.016 },
        offset: [0, 0.008, 0],
      },
      {
        name: 'grabLamp',
        parent: 'zCarriage',
        collision: 'none',
        shape: { kind: 'box', size: [0.016, 0.024, 0.028] },
        offset: [0.066, 0.05, -0.028],
        lamps: [{ name: 'grabLamp', emissive: [0.15, 0.9, 0.25], offColor: [0.04, 0.15, 0.05], param: 'manualGrab' }],
      },
      {
        name: 'detectedLamp',
        parent: 'zCarriage',
        collision: 'none',
        shape: { kind: 'box', size: [0.016, 0.024, 0.028] },
        offset: [0.066, 0.05, 0.028],
        lamps: [{ name: 'detectedLamp', emissive: [0.98, 0.75, 0.08], offColor: [0.18, 0.14, 0.04] }],
      },
      {
        name: 'sensorEye',
        parent: 'zCarriage',
        shape: { kind: 'frame' },
        offset: [0, 0.01, 0],
        beam: { range: 0.14, axis: [0, -1, 0] },
      },
      {
        name: 'gripper',
        parent: 'zCarriage',
        shape: { kind: 'frame' },
        offset: [0, 0, 0],
        grip: { zone: GRAB_ZONE },
      },
    ]

    return {
      links,
      joints: [
        {
          name: 'x',
          link: 'xCarriage',
          type: 'prismatic',
          axis: [1, 0, 0],
          min: 0,
          max: 2.5,
          maxParam: { param: 'strokeX', scale: 1, add: 0, min: 0.1 },
        },
        {
          name: 'z',
          link: 'zCarriage',
          type: 'prismatic',
          axis: [0, -1, 0],
          min: 0,
          max: 1.5,
          maxParam: { param: 'strokeZ', scale: 1, add: 0, min: 0.05 },
        },
      ],
      bounds: {
        length: 2.12,
        width: 0.48,
        top: 2.75,
        bottom: 0,
        centerX: -0.96,
        centerZ: -0.05,
      },
      posable: true,
    }
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
