definePart({
  joints: ['waterLevel'],
  lamps: ['fillLamp', 'drainLamp', 'lowLamp', 'highLamp'],
  params: {
    capacityLiters: {
      type: 'number',
      default: 4000,
      min: 500,
      max: 10000,
      step: 100,
      label: 'Capacity (L)',
      desc: 'Nominal liquid volume capacity in litres.'
    },
    fillRate: {
      type: 'number',
      default: 200,
      min: 10,
      max: 1000,
      step: 10,
      label: 'Fill Rate (L/s)',
      desc: 'Liquid volume inflow rate when the fill valve is 100% open.'
    },
    drainRate: {
      type: 'number',
      default: 150,
      min: 10,
      max: 1000,
      step: 10,
      label: 'Drain Rate (L/s)',
      desc: 'Liquid volume discharge rate when the drain valve is 100% open.'
    },
    enableComms: {
      type: 'boolean',
      default: false,
      label: 'Enable Comms',
      group: 'Comms',
      desc: 'Connect this tank to the PLC.'
    },
    fillValveTag: {
      type: 'tag',
      dir: 'in',
      stType: 'BOOL',
      autoWhenDriven: true,
      default: '',
      label: 'Fill Valve (BOOL)',
      group: 'Comms',
      desc: 'PLC command to open fill valve.'
    },
    drainValveTag: {
      type: 'tag',
      dir: 'in',
      stType: 'BOOL',
      autoWhenDriven: true,
      default: '',
      label: 'Drain Valve (BOOL)',
      group: 'Comms',
      desc: 'PLC command to open drain valve.'
    },
    levelTag: {
      type: 'tag',
      dir: 'out',
      stType: 'REAL',
      default: '',
      label: 'Level (0-100% REAL)',
      group: 'Comms',
      desc: 'Current tank level percentage (0.0 to 100.0).'
    },
    lowSensorTag: {
      type: 'tag',
      dir: 'out',
      stType: 'BOOL',
      default: '',
      label: 'Low Level Switch (BOOL)',
      group: 'Comms',
      desc: 'True when level is above low threshold (5%).'
    },
    highSensorTag: {
      type: 'tag',
      dir: 'out',
      stType: 'BOOL',
      default: '',
      label: 'High Level Switch (BOOL)',
      group: 'Comms',
      desc: 'True when level reaches high threshold (95%).'
    }
  },
  step(ctx) {
    let fill = false
    let drain = false

    if (ctx.params.enableComms) {
      if (ctx.tagDriven(ctx.params.fillValveTag)) {
        fill = ctx.readTag(ctx.params.fillValveTag)
      }
      if (ctx.tagDriven(ctx.params.drainValveTag)) {
        drain = ctx.readTag(ctx.params.drainValveTag)
      }
    }

    if (this.currentLiters === undefined) {
      this.currentLiters = 0.0
    }

    const cap = Math.max(100, ctx.params.capacityLiters)
    const netFlow = (fill ? ctx.params.fillRate : 0) - (drain ? ctx.params.drainRate : 0)
    this.currentLiters = ctx.clamp(this.currentLiters + netFlow * ctx.dt, 0, cap)

    const levelPct = (this.currentLiters / cap) * 100.0
    const normalizedLevel = this.currentLiters / cap

    ctx.joints.waterLevel = normalizedLevel * 2.0

    ctx.lamps.fillLamp = fill
    ctx.lamps.drainLamp = drain
    ctx.lamps.lowLamp = levelPct >= 5.0
    ctx.lamps.highLamp = levelPct >= 95.0

    ctx.display('levelDisplay', levelPct.toFixed(1) + ' %')

    if (ctx.params.enableComms) {
      if (ctx.params.levelTag) {
        ctx.writeNumber(ctx.params.levelTag, levelPct)
      }
      if (ctx.params.lowSensorTag) {
        ctx.writeTag(ctx.params.lowSensorTag, levelPct >= 5.0)
      }
      if (ctx.params.highSensorTag) {
        ctx.writeTag(ctx.params.highSensorTag, levelPct >= 95.0)
      }
    }
  }
})