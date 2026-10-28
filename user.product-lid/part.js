// Product Lid (Interlocking Assembly Cover): a moulded plastic/metal cover with an upper flange
// (`0.40 m x 0.40 m`), stepped top relief with vacuum pickup pad, and a lower centring boss/plug
// (`0.25 m x 0.25 m`, depth `0.034 m`) that drops into the central cavity of `user.product-base`.
//
// When placed onto a `user.product-base` by a Two-Axis Pick & Place, the lower plug engages inside
// the base's four L-shaped corner guides so the assembled two-part product travels as a single unit.

const r8 = (n) => (Math.abs(n) < 1e-9 ? 0 : +n.toFixed(8))

// Outer dimensions: 0.40 m x 0.08 m x 0.40 m (centred at [0, 0, 0]: x = ±0.20, y = ±0.04, z = ±0.20)
const L = 0.4
const H = 0.08
const W = 0.4
const HX = L / 2 // 0.20
const HY = H / 2 // 0.04
const HZ = W / 2 // 0.20

// Lower interlocking plug: 0.25 m x 0.034 m x 0.25 m (y = -0.040 .. -0.006)
// Upper cap flange:        0.40 m x 0.046 m x 0.40 m (y = -0.006 .. +0.040)
// Clearance inside `user.product-base` (0.29 m pocket): 20 mm per side (±0.02 m tolerance)
const PLUG_SIZE = 0.25
const PLUG_H = 0.034
const CAP_H = 0.046
const PLUG_Y = r8(-HY + PLUG_H / 2) // -0.023
const CAP_Y = r8(HY - CAP_H / 2)    // +0.017

definePart({
  manifest: {
    id: 'user.product-lid',
    name: 'Product Lid',
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
      default: 5,
      min: 0.5,
      max: 40,
      step: 0.5,
      unit: 'kg',
      label: 'Mass',
      desc: 'Physical mass of the product lid in kilograms (5 kg standard plastic lid).',
    },
    color: {
      type: 'color',
      default: '#65b71d',
      label: 'Lid color',
      desc: 'Body colour of the product lid (default industrial lime-green).',
    },
    partType: {
      type: 'string',
      default: 'lid',
      attribute: true,
      label: 'Part mark',
      desc: 'Product attribute carried by this lid for sensors and assembly verification.',
    },
  },
  rig() {
    return {
      bounds: {
        length: L,
        width: W,
        top: HY,
        bottom: -HY,
      },
      links: [
        // 1. Lower interlocking boss/plug (fits inside `user.product-base` central 0.29 x 0.29 m cavity)
        {
          name: 'bottomPlug',
          colorParam: 'color',
          metalness: 0.08,
          roughness: 0.48,
          shape: { kind: 'box', size: [PLUG_SIZE, PLUG_H, PLUG_SIZE] },
          offset: [0, PLUG_Y, 0],
        },

        // 2. Upper full-width cap flange (sits flush on top of the base's four corner guides)
        {
          name: 'topFlange',
          colorParam: 'color',
          metalness: 0.08,
          roughness: 0.42,
          shape: { kind: 'box', size: [L, CAP_H, W] },
          offset: [0, CAP_Y, 0],
        },

        // 3. Visual details on the top face (recessed square ring + raised central suction pad + badge,
        //    matching the green lid in the Factory I/O Assembler video)
        {
          name: 'topGroove',
          collision: 'none',
          color: [0.22, 0.38, 0.08],
          metalness: 0.12,
          roughness: 0.65,
          shape: { kind: 'box', size: [0.25, 0.004, 0.25] },
          offset: [0, r8(HY - 0.001), 0],
        },
        {
          name: 'topCenterIsland',
          collision: 'none',
          colorParam: 'color',
          metalness: 0.08,
          roughness: 0.38,
          shape: { kind: 'box', size: [0.16, 0.006, 0.16] },
          offset: [0, r8(HY + 0.001), 0],
        },
        {
          name: 'suctionTargetBadge',
          collision: 'none',
          color: [0.82, 0.85, 0.8],
          metalness: 0.15,
          roughness: 0.5,
          shape: { kind: 'box', size: [0.055, 0.007, 0.035] },
          offset: [0, r8(HY + 0.0015), 0],
        },
        // Side clamping slots on all 4 vertical faces of the lid flange
        {
          name: 'lidSlotPosX',
          collision: 'none',
          color: [0.18, 0.32, 0.06],
          metalness: 0.15,
          roughness: 0.7,
          shape: { kind: 'box', size: [0.006, 0.018, 0.08] },
          offset: [r8(HX - 0.001), CAP_Y, 0],
        },
        {
          name: 'lidSlotNegX',
          collision: 'none',
          color: [0.18, 0.32, 0.06],
          metalness: 0.15,
          roughness: 0.7,
          shape: { kind: 'box', size: [0.006, 0.018, 0.08] },
          offset: [r8(-HX + 0.001), CAP_Y, 0],
        },
        {
          name: 'lidSlotPosZ',
          collision: 'none',
          color: [0.18, 0.32, 0.06],
          metalness: 0.15,
          roughness: 0.7,
          shape: { kind: 'box', size: [0.08, 0.018, 0.006] },
          offset: [0, CAP_Y, r8(HZ - 0.001)],
        },
        {
          name: 'lidSlotNegZ',
          collision: 'none',
          color: [0.18, 0.32, 0.06],
          metalness: 0.15,
          roughness: 0.7,
          shape: { kind: 'box', size: [0.08, 0.018, 0.006] },
          offset: [0, CAP_Y, r8(-HZ + 0.001)],
        },
      ],
    }
  },
  step() {},
})
