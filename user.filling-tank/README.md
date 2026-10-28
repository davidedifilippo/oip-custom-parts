# Filling Tank (`user.filling-tank`)

Serbatoio industriale cilindrico trasparente con telaio metallico di supporto, valvola di ingresso (`Fill Valve`), valvola di scarico (`Drain Valve`), tubo di livello visivo con galleggiante, sensori di livello minimo/massimo e pannello operatore con display digitale percentuale (`0.0 – 100.0 %`).

## Parametri Configurabili

| Parametro | Tipo | Default | Range | Descrizione |
| :--- | :--- | :---: | :---: | :--- |
| `capacityLiters` | `number` | `4000` | `500 .. 10000` L | Capacità volumetrica nominale del serbatoio in litri. |
| `fillRate` | `number` | `200` | `10 .. 1000` L/s | Portata di riempimento con valvola di carico aperta. |
| `drainRate` | `number` | `150` | `10 .. 1000` L/s | Portata di svuotamento con valvola di scarico aperta. |
| `enableComms` | `boolean` | `false` | — | Abilita il collegamento dei Tag PLC. |

## Mappa Segnali I/O PLC

| Parametro Tag | Direzione (lato PLC) | Tipo IEC | Descrizione |
| :--- | :---: | :---: | :--- |
| `fillValveTag` | **OUTPUT** (`PLC → Part`) | `BOOL` | Comando apertura elettrovalvola di carico (`TRUE` = aperta). |
| `drainValveTag` | **OUTPUT** (`PLC → Part`) | `BOOL` | Comando apertura elettrovalvola di scarico (`TRUE` = aperta). |
| `levelTag` | **INPUT** (`Part → PLC`) | `REAL` | Livello attuale del liquido in percentuale (`0.0 .. 100.0`). |
| `lowSensorTag` | **INPUT** (`Part → PLC`) | `BOOL` | Sensore di minimo livello (`TRUE` quando livello $\ge 5\%$). |
| `highSensorTag` | **INPUT** (`Part → PLC`) | `BOOL` | Sensore di massimo livello (`TRUE` quando livello $\ge 95\%$). |
