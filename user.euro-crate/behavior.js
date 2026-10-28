// Euro Crate (KLT Industrial Container): an open-top ribbed plastic container with a hollow 5-wall
// physics collider (foot, inner floor and four perimeter walls) and stacking foot (`nestDepth: 0.015`).
//
// Supports two use cases on conveyors and handling cells:
//  1. SOLID OBJECTS: with `liquidFill = 0` (default), the interior cavity is physically hollow, so small
//     parts or boxes dropped into the crate by a spawner or Pick & Place robot land on the crate's inner
//     floor and ride along inside it.
//  2. LIQUIDS / BATHS: raising `liquidFill` (0..100%) fills the interior cavity with a translucent liquid
//     volume and updates the internal level.

definePart({
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
  step() {},
})
