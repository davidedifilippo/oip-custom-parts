# Two-Axis Pick & Place (`user.two-axis-pick-and-place`)

Manipolatore cartesiano a sbalzo a **2 gradi di libertà (X-Z)** con:
* **Colonna portante a pavimento** e carter motore rosso per l'asse orizzontale **X** (`xHousingBody`) con profilato di alluminio scanalato scorrevole (`xBeam`).
* **Unità verticale asse Z** (`zHousingBody`) montata in punta al braccio X, con **doppio stelo cromato di guida** (`zRodL`, `zRodR`), stelo centrale e piastra superiore di battuta (`zTopPlate`).
* **Testina di presa a vuoto (`suctionCup` + `gripper`)** con sensore ottico/prossimità di presenza pezzo (`sensorEye`) e indicatori LED a bordo macchina.

## Parametri Configurabili

| Parametro | Gruppo | Default | Range | Descrizione |
| :--- | :--- | :---: | :---: | :--- |
| `strokeX` | `Size` | `1.20 m` | `0.30 .. 2.50 m` | Corsa massima di estensione orizzontale lungo l'asse X. |
| `strokeZ` | `Size` | `0.55 m` | `0.10 .. 1.50 m` | Corsa massima di discesa verticale lungo l'asse Z. |
| `mountHeight` | `Size` | `1.45 m` | `0.80 .. 2.50 m` | Altezza della ventosa da terra con asse Z completamente sollevato (`z = 0`). |
| `speedX` | `Motion` | `0.80 m/s` | `0.10 .. 4.00 m/s` | Velocità massima di traslazione orizzontale X. |
| `speedZ` | `Motion` | `0.60 m/s` | `0.10 .. 3.00 m/s` | Velocità massima di traslazione verticale Z. |
| `accel` | `Motion` | `4.0 m/s²` | `0.5 .. 20.0 m/s²` | Rampa di accelerazione/decelerazione per entrambi gli assi. |
| `mode` | `Comms` | `digital` | `digital \| analog \| bistable` | Seleziona la modalità di pilotaggio da PLC. |

## Modalità di Controllo e Mappa Tag PLC

### 1. Modalità `digital` (Default — Monostabile `Move X` / `Move Z`)
| Parametro Tag | Direzione (lato PLC) | Tipo IEC | Descrizione |
| :--- | :---: | :---: | :--- |
| `moveXTag` | **OUTPUT** (`PLC → Part`) | `BOOL` | `FALSE` = retratto (`0 m`), `TRUE` = esteso (`strokeX`). |
| `moveZTag` | **OUTPUT** (`PLC → Part`) | `BOOL` | `FALSE` = sollevato (`0 m`), `TRUE` = abbassato (`strokeZ`). |
| `grabTag` | **OUTPUT** (`PLC → Part`) | `BOOL` | Attiva la ventosa a vuoto (`TRUE` = presa attiva). |
| `movingXTag` | **INPUT** (`Part → PLC`) | `BOOL` | `TRUE` mentre l'asse X è in movimento. |
| `movingZTag` | **INPUT** (`Part → PLC`) | `BOOL` | `TRUE` mentre l'asse Z è in movimento. |
| `detectedTag` | **INPUT** (`Part → PLC`) | `BOOL` | `TRUE` quando un pezzo è rilevato sotto la ventosa o trattenuto. |

### 2. Modalità `analog` (Controllo continuo di posizione `Target X` / `Target Z`)
| Parametro Tag | Direzione (lato PLC) | Tipo IEC | Descrizione |
| :--- | :---: | :---: | :--- |
| `targetXTag` | **OUTPUT** (`PLC → Part`) | `REAL` | Setpoint posizione orizzontale X in metri (`0.0 .. strokeX`). |
| `targetZTag` | **OUTPUT** (`PLC → Part`) | `REAL` | Setpoint quota di discesa verticale Z in metri (`0.0 .. strokeZ`). |
| `grabTag` | **OUTPUT** (`PLC → Part`) | `BOOL` | Attiva la ventosa a vuoto (`TRUE` = presa attiva). |
| `actualXTag` | **INPUT** (`Part → PLC`) | `REAL` | Posizione corrente asse X in metri. |
| `actualZTag` | **INPUT** (`Part → PLC`) | `REAL` | Posizione corrente asse Z in metri. |

### 3. Modalità `bistable` (`X+ / X- / Z+ / Z-`) e Feedback Finecorsa (`Comms/Feedback`)
* Comandi direzionali: `moveXPosTag`, `moveXNegTag`, `moveZPosTag`, `moveZNegTag` (`BOOL`).
* Finecorsa digitali sempre disponibili in `Comms/Feedback`: `atHomeXTag`, `atEndXTag`, `atTopZTag`, `atBottomZTag` (`BOOL`).
