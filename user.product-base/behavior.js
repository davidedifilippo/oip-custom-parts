// Product Base (Interlocking Assembly Base): a machined plastic/metal square pallet-tray with four
// raised L-shaped corner guides and a central square cavity (`0.29 m x 0.29 m`, depth `0.036 m`).
//
// Designed to mate physically with `user.product-lid`: when a Two-Axis Pick & Place lowers a Product Lid
// onto this base, the lid's underside plug drops into the central pocket between the four corner guides,
// locking the lid against horizontal sliding during conveyor transport.

definePart({
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
  step() {},
})
