// Product Lid (Interlocking Assembly Cover): a moulded plastic/metal cover with an upper flange
// (`0.40 m x 0.40 m`), stepped top relief with vacuum pickup pad, and a lower centring boss/plug
// (`0.25 m x 0.25 m`, depth `0.034 m`) that drops into the central cavity of `user.product-base`.
//
// When placed onto a `user.product-base` by a Two-Axis Pick & Place, the lower plug engages inside
// the base's four L-shaped corner guides so the assembled two-part product travels as a single unit.

definePart({
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
  step() {},
})
