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

const r8 = (n) => (Math.abs(n) < 1e-9 ? 0 : +n.toFixed(8))

const MIN_BUSY_SEC = 0.06
const FORK_BASE_Y = 0.8 // standard conveyor / home fork top height above floor (m)

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
  manifest: {
    id: 'user.stacker-crane',
    name: 'Stacker Crane (AS/RS)',
    category: 'Equipment',
    commsParam: 'enableComms',
    materials: [
      { id: 'mastOrange', color: [0.92, 0.43, 0.03], metalness: 0.2, roughness: 0.42 },
      { id: 'bogieYellow', color: [0.95, 0.68, 0.05], metalness: 0.18, roughness: 0.45 },
      { id: 'portalDark', color: [0.14, 0.16, 0.18], metalness: 0.55, roughness: 0.48 },
      { id: 'carriageSteel', color: [0.24, 0.27, 0.3], metalness: 0.5, roughness: 0.42 },
      { id: 'forkSteel', color: [0.62, 0.66, 0.7], metalness: 0.7, roughness: 0.28 },
      { id: 'motorRed', color: [0.72, 0.12, 0.08], metalness: 0.3, roughness: 0.45 },
      { id: 'cabinetGrey', color: [0.76, 0.78, 0.8], metalness: 0.15, roughness: 0.5 },
    ],
  },
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

  rig(p) {
    const railSpan = r8(p.railLength + 1.6)
    const railCenterX = r8(p.railLength / 2)
    const totalH = r8(FORK_BASE_Y + p.mastHeight + 0.55)
    const mastH = r8(FORK_BASE_Y + p.mastHeight + 0.35)

    return {
      bounds: {
        length: 21.8,
        width: 4.5,
        top: 13.0,
        bottom: 0,
        centerX: 9.9,
      },
      joints: [
        { name: 'travel', link: 'xCarriage', type: 'prismatic', axis: [1, 0, 0], min: 0, max: 20.0 },
        { name: 'lift', link: 'yCarriage', type: 'prismatic', axis: [0, 1, 0], min: 0, max: 12.5 },
        { name: 'forks', link: 'zForks', type: 'prismatic', axis: [0, 0, 1], min: -2.2, max: 2.2 },
      ],
      links: [
        // 1. Static floor rail & overhead guide portal (collision: 'none' except end base plates so cargo/conveyors never snag)
        {
          name: 'floorRailBeam',
          collision: 'none',
          color: [0.16, 0.18, 0.2],
          metalness: 0.6,
          roughness: 0.4,
          shape: { kind: 'box', size: [railSpan, 0.06, 0.16] },
          offset: [railCenterX, 0.03, 0],
        },
        {
          name: 'floorRailTop',
          collision: 'none',
          color: [0.72, 0.75, 0.78],
          metalness: 0.8,
          roughness: 0.22,
          shape: { kind: 'box', size: [railSpan, 0.025, 0.07] },
          offset: [railCenterX, 0.0725, 0],
        },
        {
          name: 'bufferStart',
          collision: 'none',
          color: [0.95, 0.68, 0.05],
          metalness: 0.2,
          roughness: 0.5,
          shape: { kind: 'box', size: [0.12, 0.16, 0.24] },
          offset: [-0.74, 0.1, 0],
        },
        {
          name: 'bufferEnd',
          collision: 'none',
          color: [0.95, 0.68, 0.05],
          metalness: 0.2,
          roughness: 0.5,
          shape: { kind: 'box', size: [0.12, 0.16, 0.24] },
          offset: [r8(p.railLength + 0.74), 0.1, 0],
        },
        // End portal columns & top guide rail (as in the Factory I/O Automated Warehouse video)
        {
          name: 'portalColStart',
          shape: { kind: 'box', size: [0.18, totalH, 0.18] },
          offset: [-0.85, r8(totalH / 2), 0],
          color: [0.14, 0.16, 0.18],
          metalness: 0.55,
          roughness: 0.48,
        },
        {
          name: 'portalColEnd',
          collision: 'none',
          shape: { kind: 'box', size: [0.18, totalH, 0.18] },
          offset: [r8(p.railLength + 0.85), r8(totalH / 2), 0],
          color: [0.14, 0.16, 0.18],
          metalness: 0.55,
          roughness: 0.48,
        },
        {
          name: 'overheadGuideRail',
          collision: 'none',
          shape: { kind: 'box', size: [r8(railSpan + 0.3), 0.16, 0.22] },
          offset: [railCenterX, r8(totalH - 0.08), 0],
          color: [0.14, 0.16, 0.18],
          metalness: 0.55,
          roughness: 0.48,
        },

        // 2. Traveling Mast Assembly ('xCarriage' moves along +X)
        {
          name: 'xCarriage',
          shape: { kind: 'frame' },
          offset: [0, 0, 0],
        },
        // Yellow bottom wheel bogie
        {
          name: 'bogieChassis',
          parent: 'xCarriage',
          collision: 'none',
          color: [0.95, 0.68, 0.05],
          metalness: 0.2,
          roughness: 0.45,
          shape: { kind: 'box', size: [1.36, 0.22, 0.42] },
          offset: [0, 0.19, 0],
        },
        {
          name: 'bogieWheelBlockL',
          parent: 'xCarriage',
          collision: 'none',
          color: [0.18, 0.2, 0.22],
          metalness: 0.5,
          roughness: 0.5,
          shape: { kind: 'box', size: [0.28, 0.18, 0.48] },
          offset: [-0.52, 0.14, 0],
        },
        {
          name: 'bogieWheelBlockR',
          parent: 'xCarriage',
          collision: 'none',
          color: [0.18, 0.2, 0.22],
          metalness: 0.5,
          roughness: 0.5,
          shape: { kind: 'box', size: [0.28, 0.18, 0.48] },
          offset: [0.52, 0.14, 0],
        },
        {
          name: 'driveMotorX',
          parent: 'xCarriage',
          collision: 'none',
          color: [0.72, 0.12, 0.08],
          metalness: 0.3,
          roughness: 0.45,
          shape: { kind: 'cylinder', radius: 0.09, height: 0.26 },
          offset: [-0.48, 0.34, -0.18],
        },
        // Twin tall safety-orange mast columns (front & back along X so the lift cradle rides between them)
        {
          name: 'mastColumnBack',
          parent: 'xCarriage',
          collision: 'none',
          color: [0.92, 0.43, 0.03],
          metalness: 0.2,
          roughness: 0.42,
          shape: { kind: 'box', size: [0.18, mastH, 0.26] },
          offset: [-0.42, r8(mastH / 2 + 0.1), 0],
        },
        {
          name: 'mastColumnFront',
          parent: 'xCarriage',
          collision: 'none',
          color: [0.92, 0.43, 0.03],
          metalness: 0.2,
          roughness: 0.42,
          shape: { kind: 'box', size: [0.18, mastH, 0.26] },
          offset: [0.42, r8(mastH / 2 + 0.1), 0],
        },
        {
          name: 'mastTopYoke',
          parent: 'xCarriage',
          collision: 'none',
          color: [0.95, 0.68, 0.05],
          metalness: 0.2,
          roughness: 0.45,
          shape: { kind: 'box', size: [1.08, 0.16, 0.32] },
          offset: [0, r8(mastH + 0.04), 0],
        },
        // Onboard electrical control cabinet on the mast
        {
          name: 'mastCabinet',
          parent: 'xCarriage',
          collision: 'none',
          color: [0.76, 0.78, 0.8],
          metalness: 0.15,
          roughness: 0.5,
          shape: { kind: 'box', size: [0.28, 0.75, 0.34] },
          offset: [-0.66, 0.75, 0],
        },
        // Status lamps & digital readout on the mast cabinet
        {
          name: 'statusPanel',
          parent: 'xCarriage',
          collision: 'none',
          color: [0.14, 0.16, 0.18],
          metalness: 0.3,
          roughness: 0.5,
          shape: { kind: 'box', size: [0.04, 0.36, 0.26] },
          offset: [-0.81, 0.82, 0],
        },
        {
          name: 'lampMovingXBox',
          parent: 'xCarriage',
          collision: 'none',
          shape: { kind: 'box', size: [0.015, 0.03, 0.03] },
          offset: [-0.835, 0.94, -0.08],
          lamps: [{ name: 'movingXLamp', emissive: [1.0, 0.75, 0.05], offColor: [0.22, 0.16, 0.03] }],
        },
        {
          name: 'lampMovingZBox',
          parent: 'xCarriage',
          collision: 'none',
          shape: { kind: 'box', size: [0.015, 0.03, 0.03] },
          offset: [-0.835, 0.94, -0.025],
          lamps: [{ name: 'movingZLamp', emissive: [0.1, 0.75, 1.0], offColor: [0.03, 0.16, 0.22] }],
        },
        {
          name: 'lampLiftBox',
          parent: 'xCarriage',
          collision: 'none',
          shape: { kind: 'box', size: [0.015, 0.03, 0.03] },
          offset: [-0.835, 0.94, 0.03],
          lamps: [{ name: 'liftLamp', emissive: [0.1, 0.95, 0.3], offColor: [0.03, 0.2, 0.07] }],
        },
        {
          name: 'lampLoadedBox',
          parent: 'xCarriage',
          collision: 'none',
          shape: { kind: 'box', size: [0.015, 0.03, 0.03] },
          offset: [-0.835, 0.94, 0.085],
          lamps: [{ name: 'loadedLamp', emissive: [0.95, 0.2, 0.9], offColor: [0.2, 0.04, 0.18] }],
        },
        {
          name: 'craneDisplayLabel',
          parent: 'xCarriage',
          collision: 'none',
          color: [0.1, 0.95, 0.4],
          offset: [-0.832, 0.76, 0],
          quat: [0, -0.70710678, 0, 0.70710678],
          shape: {
            kind: 'label',
            size: [0.22, 0.07],
            textFrom: 'craneDisplay',
          },
        },

        // 3. Vertical Lift Carriage ('yCarriage' rides along +Y inside the twin mast)
        {
          name: 'yCarriage',
          parent: 'xCarriage',
          shape: { kind: 'frame' },
          offset: [0, FORK_BASE_Y, 0],
        },
        {
          name: 'cradleBed',
          parent: 'yCarriage',
          collision: 'none',
          color: [0.22, 0.25, 0.28],
          metalness: 0.5,
          roughness: 0.42,
          shape: { kind: 'box', size: [0.76, 0.08, 0.76] },
          offset: [0, -0.07, 0],
        },
        // Side safety shields flanking the load table (as seen in the Factory I/O Stacker Crane)
        {
          name: 'sideShieldBack',
          parent: 'yCarriage',
          collision: 'none',
          color: [0.52, 0.56, 0.6],
          metalness: 0.45,
          roughness: 0.45,
          shape: { kind: 'box', size: [0.04, 0.34, 0.74] },
          offset: [-0.36, 0.14, 0],
        },
        {
          name: 'sideShieldFront',
          parent: 'yCarriage',
          collision: 'none',
          color: [0.52, 0.56, 0.6],
          metalness: 0.45,
          roughness: 0.45,
          shape: { kind: 'box', size: [0.04, 0.34, 0.74] },
          offset: [0.36, 0.14, 0],
        },

        // 4. Bidirectional Telescopic Shuttle Forks ('zForks' slides along ±Z)
        {
          name: 'zForks',
          parent: 'yCarriage',
          shape: { kind: 'frame' },
          offset: [0, 0, 0],
        },
        {
          name: 'shuttleCenterPlate',
          parent: 'zForks',
          collision: 'none',
          color: [0.32, 0.35, 0.38],
          metalness: 0.55,
          roughness: 0.38,
          shape: { kind: 'box', size: [0.58, 0.03, 0.72] },
          offset: [0, -0.025, 0],
        },
        {
          name: 'forkBladeBack',
          parent: 'zForks',
          collision: 'none',
          color: [0.68, 0.72, 0.76],
          metalness: 0.75,
          roughness: 0.25,
          shape: { kind: 'box', size: [0.12, 0.036, 0.78] },
          offset: [-0.18, -0.018, 0],
        },
        {
          name: 'forkBladeFront',
          parent: 'zForks',
          collision: 'none',
          color: [0.68, 0.72, 0.76],
          metalness: 0.75,
          roughness: 0.25,
          shape: { kind: 'box', size: [0.12, 0.036, 0.78] },
          offset: [0.18, -0.018, 0],
        },
        // Kinematic multigrab zone on the forks (captures pallet/crate + any items inside the crate)
        {
          name: 'forkGrip',
          parent: 'zForks',
          shape: { kind: 'frame' },
          offset: [0, 0, 0],
          grip: {
            zone: { size: [0.75, 0.65, 0.75], offset: [0, 0.3, 0] },
          },
        },
        // Upward optical sensor on the fork table to detect presence of cargo above the forks
        {
          name: 'forkSensorEye',
          parent: 'zForks',
          shape: { kind: 'frame' },
          offset: [0, -0.01, 0],
          beam: {
            range: 0.35,
            axis: [0, 1, 0],
            showParam: 'enableComms',
          },
        },
      ],
    }
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
