// Product Base (Interlocking Assembly Base): a machined plastic/metal square pallet-tray with four
// raised L-shaped corner guides and a central square cavity (`0.29 m x 0.29 m`, depth `0.036 m`).
//
// Designed to mate physically with `user.product-lid`: when a Two-Axis Pick & Place lowers a Product Lid
// onto this base, the lid's underside plug drops into the central pocket between the four corner guides,
// locking the lid against horizontal sliding during conveyor transport.

const r8 = (n) => (Math.abs(n) < 1e-9 ? 0 : +n.toFixed(8))

// Outer dimensions: 0.40 m x 0.08 m x 0.40 m (centred at [0, 0, 0]: x = ±0.20, y = ±0.04, z = ±0.20)
const L = 0.4
const H = 0.08
const W = 0.4
const HX = L / 2 // 0.20
const HY = H / 2 // 0.04
const HZ = W / 2 // 0.20

// Lower slab thickness = 0.044 m (y = -0.040 .. +0.004)
// Upper corner L-lugs height = 0.036 m (y = +0.004 .. +0.040)
// Central pocket between corner L-lugs = 0.29 m x 0.29 m (x, z in [-0.145 .. +0.145])
const FLOOR_H = 0.044
const LUG_H = 0.036
const FLOOR_Y = r8(-HY + FLOOR_H / 2) // -0.018
const LUG_Y = r8(HY - LUG_H / 2)      // +0.022
const LUG_T = 0.055                   // wall thickness of the corner guides (0.20 - 0.055 = 0.145 inner face)
const LUG_ARM = 0.14                  // length of each L-guide arm from the outer corner

definePart({
  manifest: {
    id: 'user.product-base',
    name: 'Product Base',
    category: 'Products',
    cargo: {
      friction: 0.65,
      separateContacts: true,
      heavy: true,
      massParam: 'mass',
      colorParam: 'color',
    },
    materials: [],
  },
  params: {
    mass: {
      type: 'number',
      default: 7,
      min: 0.5,
      max: 50,
      step: 0.5,
      unit: 'kg',
      label: 'Mass',
      desc: 'Physical mass of the product base in kilograms (7 kg standard plastic base).',
    },
    color: {
      type: 'color',
      default: '#0095d9',
      label: 'Base color',
      desc: 'Body colour of the machined product base (default industrial cyan-blue).',
    },
    partType: {
      type: 'string',
      default: 'base',
      attribute: true,
      label: 'Part mark',
      desc: 'Product attribute carried by this base for sensors and downstream stations.',
    },
  },
  rig() {
    const armLongOff = r8(HX - LUG_ARM / 2)               // 0.20 - 0.07 = 0.13
    const armEdgeOff = r8(HX - LUG_T / 2)                 // 0.20 - 0.0275 = 0.1725
    const armShortLen = r8(LUG_ARM - LUG_T)               // 0.14 - 0.055 = 0.085
    const armShortOff = r8(HZ - LUG_T - armShortLen / 2)  // 0.20 - 0.055 - 0.0425 = 0.1025

    return {
      bounds: {
        length: L,
        width: W,
        top: HY,
        bottom: -HY,
      },
      links: [
        // 1. Solid lower base plate (spans full 0.40 x 0.40 footprint, y = -0.040 .. +0.004)
        {
          name: 'basePlate',
          colorParam: 'color',
          metalness: 0.08,
          roughness: 0.45,
          shape: { kind: 'box', size: [L, FLOOR_H, W] },
          offset: [0, FLOOR_Y, 0],
        },

        // 2. Four raised L-shaped corner guides (y = +0.004 .. +0.040), leaving a 0.29 x 0.29 m
        //    central pocket and 0.12 m side channels for the lid's underside boss.
        // Front-Left (+X, +Z)
        {
          name: 'lugFL_x',
          colorParam: 'color',
          metalness: 0.08,
          roughness: 0.42,
          shape: { kind: 'box', size: [LUG_ARM, LUG_H, LUG_T] },
          offset: [armLongOff, LUG_Y, armEdgeOff],
        },
        {
          name: 'lugFL_z',
          colorParam: 'color',
          metalness: 0.08,
          roughness: 0.42,
          shape: { kind: 'box', size: [LUG_T, LUG_H, armShortLen] },
          offset: [armEdgeOff, LUG_Y, armShortOff],
        },
        // Front-Right (+X, -Z)
        {
          name: 'lugFR_x',
          colorParam: 'color',
          metalness: 0.08,
          roughness: 0.42,
          shape: { kind: 'box', size: [LUG_ARM, LUG_H, LUG_T] },
          offset: [armLongOff, LUG_Y, -armEdgeOff],
        },
        {
          name: 'lugFR_z',
          colorParam: 'color',
          metalness: 0.08,
          roughness: 0.42,
          shape: { kind: 'box', size: [LUG_T, LUG_H, armShortLen] },
          offset: [armEdgeOff, LUG_Y, -armShortOff],
        },
        // Back-Left (-X, +Z)
        {
          name: 'lugBL_x',
          colorParam: 'color',
          metalness: 0.08,
          roughness: 0.42,
          shape: { kind: 'box', size: [LUG_ARM, LUG_H, LUG_T] },
          offset: [-armLongOff, LUG_Y, armEdgeOff],
        },
        {
          name: 'lugBL_z',
          colorParam: 'color',
          metalness: 0.08,
          roughness: 0.42,
          shape: { kind: 'box', size: [LUG_T, LUG_H, armShortLen] },
          offset: [-armEdgeOff, LUG_Y, armShortOff],
        },
        // Back-Right (-X, -Z)
        {
          name: 'lugBR_x',
          colorParam: 'color',
          metalness: 0.08,
          roughness: 0.42,
          shape: { kind: 'box', size: [LUG_ARM, LUG_H, LUG_T] },
          offset: [-armLongOff, LUG_Y, -armEdgeOff],
        },
        {
          name: 'lugBR_z',
          colorParam: 'color',
          metalness: 0.08,
          roughness: 0.42,
          shape: { kind: 'box', size: [LUG_T, LUG_H, armShortLen] },
          offset: [-armEdgeOff, LUG_Y, -armShortOff],
        },

        // 3. Visual details (machined pocket floor recess and side clamping notches, matching Factory I/O)
        {
          name: 'pocketRecess',
          collision: 'none',
          color: [0.06, 0.25, 0.38],
          metalness: 0.15,
          roughness: 0.65,
          shape: { kind: 'box', size: [0.22, 0.004, 0.22] },
          offset: [0, r8(-HY + FLOOR_H + 0.001), 0],
        },
        {
          name: 'centerBoss',
          collision: 'none',
          colorParam: 'color',
          metalness: 0.1,
          roughness: 0.4,
          shape: { kind: 'box', size: [0.12, 0.006, 0.12] },
          offset: [0, r8(-HY + FLOOR_H + 0.002), 0],
        },
        // Side clamping slots on all 4 vertical edges
        {
          name: 'slotPosX',
          collision: 'none',
          color: [0.08, 0.16, 0.24],
          metalness: 0.2,
          roughness: 0.7,
          shape: { kind: 'box', size: [0.006, 0.022, 0.09] },
          offset: [r8(HX - 0.001), -0.016, 0],
        },
        {
          name: 'slotNegX',
          collision: 'none',
          color: [0.08, 0.16, 0.24],
          metalness: 0.2,
          roughness: 0.7,
          shape: { kind: 'box', size: [0.006, 0.022, 0.09] },
          offset: [r8(-HX + 0.001), -0.016, 0],
        },
        {
          name: 'slotPosZ',
          collision: 'none',
          color: [0.08, 0.16, 0.24],
          metalness: 0.2,
          roughness: 0.7,
          shape: { kind: 'box', size: [0.09, 0.022, 0.006] },
          offset: [0, -0.016, r8(HZ - 0.001)],
        },
        {
          name: 'slotNegZ',
          collision: 'none',
          color: [0.08, 0.16, 0.24],
          metalness: 0.2,
          roughness: 0.7,
          shape: { kind: 'box', size: [0.09, 0.022, 0.006] },
          offset: [0, -0.016, r8(-HZ + 0.001)],
        },
      ],
    }
  },
  step() {},
})
