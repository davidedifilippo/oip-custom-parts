// Euro Crate (KLT Industrial Container): an open-top ribbed plastic container with a hollow 5-wall
// physics collider (foot, inner floor and four perimeter walls) and stacking foot (`nestDepth: 0.015`).
//
// Supports two use cases on conveyors and handling cells:
//  1. SOLID OBJECTS: with `liquidFill = 0` (default), the interior cavity is physically hollow, so small
//     parts or boxes dropped into the crate by a spawner or Pick & Place robot land on the crate's inner
//     floor and ride along inside it.
//  2. LIQUIDS / BATHS: raising `liquidFill` (0..100%) fills the interior cavity with a translucent liquid
//     volume and updates the internal level.

const r8 = (n) => (Math.abs(n) < 1e-9 ? 0 : +n.toFixed(8))

// Standard 600 x 400 x 280 mm Euro KLT outer dimensions (centred on [0, 0, 0]: x = ±0.30, y = ±0.14, z = ±0.20)
const L = 0.6
const H = 0.28
const W = 0.4
const HX = L / 2       // 0.30
const HY = H / 2       // 0.14
const HZ = W / 2       // 0.20
const FOOT_H = 0.015   // stacking foot height
const FLOOR_T = 0.008  // floor thickness
const WALL_T = 0.021   // collider wall thickness (rim depth)
const LEDGE_Y = r8(-HY + FOOT_H) // -0.125

definePart({
  manifest: {
    id: 'user.euro-crate',
    name: 'Euro Crate (KLT)',
    category: 'Products',
    cargo: {
      friction: 0.45,
      separateContacts: true,
      heavy: true,
      nestDepth: FOOT_H,
      massParam: 'mass',
      colorParam: 'color',
    },
    materials: [],
  },
  params: {
    mass: {
      type: 'number',
      default: 2.2,
      min: 0.5,
      max: 60,
      step: 0.2,
      unit: 'kg',
      label: 'Mass',
      desc: 'Physical mass of the crate in kilograms (increase when pre-filled with liquid).',
    },
    color: {
      type: 'color',
      default: '#c8c4bc',
      label: 'Crate color',
      desc: 'Plastic shell colour (default industrial KLT light grey).',
    },
    hasLiquid: {
      type: 'boolean',
      default: false,
      label: 'Contains liquid',
      desc: 'Show a translucent liquid volume inside the crate cavity.',
    },
    liquidFill: {
      type: 'number',
      default: 0.65,
      min: 0.05,
      max: 0.95,
      step: 0.05,
      unit: '%',
      visibleWhen: { param: 'hasLiquid', is: true },
      label: 'Liquid level',
      desc: 'Fill fraction of the internal cavity when Contains liquid is enabled.',
    },
    contentsTag: {
      type: 'string',
      default: '',
      attribute: true,
      label: 'Contents mark',
      desc: 'Optional product attribute / batch ID carried with the crate for sensors and scanners.',
    },
  },
  rig(p) {
    const innerL = r8(L - 2 * WALL_T) // 0.558
    const innerW = r8(W - 2 * WALL_T) // 0.358
    const wallH = r8(H - FOOT_H)      // 0.265
    const wallCenterY = r8(LEDGE_Y + wallH / 2) // 0.0075
    const floorTopY = r8(LEDGE_Y + FLOOR_T)     // -0.117
    const cavityH = r8(HY - floorTopY - 0.018)  // 0.239 max liquid height

    const fill = p.liquidFill
    const liqH = r8(cavityH * fill)
    const liqCenterY = r8(floorTopY + liqH / 2)

    const links = [
      // 1. Hollow 5-wall physics collider (exact outer bounds: x ±0.30, y ±0.14, z ±0.20, centred at [0, 0, 0])
      //    We symmetrically extend the foot tabs to ±HX, ±HZ at y = -HY..-0.125 so the outer bounding box is
      //    strictly [-0.30..0.30, -0.14..0.14, -0.20..0.20].
      {
        name: 'foot',
        colorParam: 'color',
        metalness: 0.05,
        roughness: 0.65,
        shape: { kind: 'box', size: [0.552, FOOT_H, 0.352] },
        offset: [0, r8(-HY + FOOT_H / 2), 0],
      },
      {
        name: 'floor',
        colorParam: 'color',
        metalness: 0.05,
        roughness: 0.65,
        shape: { kind: 'box', size: [0.579, FLOOR_T, 0.379] },
        offset: [0, r8(LEDGE_Y + FLOOR_T / 2), 0],
      },
      {
        name: 'wallFront',
        colorParam: 'color',
        metalness: 0.05,
        roughness: 0.6,
        shape: { kind: 'box', size: [L, wallH, WALL_T] },
        offset: [0, wallCenterY, r8(HZ - WALL_T / 2)],
      },
      {
        name: 'wallBack',
        colorParam: 'color',
        metalness: 0.05,
        roughness: 0.6,
        shape: { kind: 'box', size: [L, wallH, WALL_T] },
        offset: [0, wallCenterY, r8(-HZ + WALL_T / 2)],
      },
      {
        name: 'wallLeft',
        colorParam: 'color',
        metalness: 0.05,
        roughness: 0.6,
        shape: { kind: 'box', size: [WALL_T, wallH, innerW] },
        offset: [r8(HX - WALL_T / 2), wallCenterY, 0],
      },
      {
        name: 'wallRight',
        colorParam: 'color',
        metalness: 0.05,
        roughness: 0.6,
        shape: { kind: 'box', size: [WALL_T, wallH, innerW] },
        offset: [r8(-HX + WALL_T / 2), wallCenterY, 0],
      },

      // 2. KLT Visual Details (top rim, vertical corner/side ribs, recessed hand-grip slots, barcode patch)
      {
        name: 'rimFront',
        collision: 'none',
        colorParam: 'color',
        metalness: 0.05,
        roughness: 0.5,
        shape: { kind: 'box', size: [L, 0.022, 0.026] },
        offset: [0, r8(HY - 0.011), r8(HZ - 0.013)],
      },
      {
        name: 'rimBack',
        collision: 'none',
        colorParam: 'color',
        metalness: 0.05,
        roughness: 0.5,
        shape: { kind: 'box', size: [L, 0.022, 0.026] },
        offset: [0, r8(HY - 0.011), r8(-HZ + 0.013)],
      },
      {
        name: 'rimLeft',
        collision: 'none',
        colorParam: 'color',
        metalness: 0.05,
        roughness: 0.5,
        shape: { kind: 'box', size: [0.026, 0.022, W] },
        offset: [r8(HX - 0.013), r8(HY - 0.011), 0],
      },
      {
        name: 'rimRight',
        collision: 'none',
        colorParam: 'color',
        metalness: 0.05,
        roughness: 0.5,
        shape: { kind: 'box', size: [0.026, 0.022, W] },
        offset: [r8(-HX + 0.013), r8(HY - 0.011), 0],
      },
      // Recessed hand-grip slots on the two short ends (±X)
      {
        name: 'handleSlotPosX',
        collision: 'none',
        color: [0.16, 0.17, 0.18],
        metalness: 0.1,
        roughness: 0.8,
        shape: { kind: 'box', size: [0.006, 0.034, 0.11] },
        offset: [r8(HX + 0.001), r8(HY - 0.052), 0],
      },
      {
        name: 'handleSlotNegX',
        collision: 'none',
        color: [0.16, 0.17, 0.18],
        metalness: 0.1,
        roughness: 0.8,
        shape: { kind: 'box', size: [0.006, 0.034, 0.11] },
        offset: [r8(-HX - 0.001), r8(HY - 0.052), 0],
      },
      // KLT corner vertical ribs
      {
        name: 'ribFL',
        collision: 'none',
        colorParam: 'color',
        metalness: 0.08,
        roughness: 0.55,
        shape: { kind: 'box', size: [0.028, wallH, 0.028] },
        offset: [r8(HX - 0.014), wallCenterY, r8(HZ - 0.014)],
      },
      {
        name: 'ribFR',
        collision: 'none',
        colorParam: 'color',
        metalness: 0.08,
        roughness: 0.55,
        shape: { kind: 'box', size: [0.028, wallH, 0.028] },
        offset: [r8(HX - 0.014), wallCenterY, r8(-HZ + 0.014)],
      },
      {
        name: 'ribBL',
        collision: 'none',
        colorParam: 'color',
        metalness: 0.08,
        roughness: 0.55,
        shape: { kind: 'box', size: [0.028, wallH, 0.028] },
        offset: [r8(-HX + 0.014), wallCenterY, r8(HZ - 0.014)],
      },
      {
        name: 'ribBR',
        collision: 'none',
        colorParam: 'color',
        metalness: 0.08,
        roughness: 0.55,
        shape: { kind: 'box', size: [0.028, wallH, 0.028] },
        offset: [r8(-HX + 0.014), wallCenterY, r8(-HZ + 0.014)],
      },
      // Technical label / barcode stamp on the short side (as in the screenshot)
      {
        name: 'kltLabel',
        collision: 'none',
        color: [0.22, 0.23, 0.24],
        metalness: 0.05,
        roughness: 0.75,
        shape: { kind: 'box', size: [0.004, 0.036, 0.085] },
        offset: [r8(-HX - 0.001), r8(LEDGE_Y + 0.045), -0.09],
      },

      // 3. Optional internal liquid volume (visible and solid when `hasLiquid` is true)
      {
        name: 'liquidBody',
        showParam: 'hasLiquid',
        color: [0.08, 0.48, 0.86],
        opacity: 0.72,
        shape: { kind: 'box', size: [r8(innerL - 0.004), liqH, r8(innerW - 0.004)] },
        offset: [0, liqCenterY, 0],
      },
    ]

    return {
      links,
      joints: [],
      bounds: {
        length: L,
        width: W,
        top: HY,
        bottom: -HY,
      },
    }
  },
  step() {},
})
