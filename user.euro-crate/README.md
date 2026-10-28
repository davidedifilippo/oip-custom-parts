# Euro Crate / Cassetta KLT (`user.euro-crate`)

Cassetta industriale standard **Euro KLT (`600 × 400 × 280 mm`)** aperta superiormente, con nervature angolari di irrigidimento, bordo perimetrale di impilamento, maniglie passanti sui lati corti (`±X`) e piedino inferiore di centraggio (`nestDepth: 15 mm`).

## Caratteristiche Fisiche (Jolt Physics)

1. **Cavità interna realmente cava per inserimento oggetti**:
   * Il collider fisico è un corpo composto (`CargoPiece[]`) formato da **base (`foot`)**, **fondo interno (`floor`)** e **4 pareti perimetrali (`wallFront`, `wallBack`, `wallLeft`, `wallRight`)** con `separateContacts: true` e `heavy: true`.
   * Qualsiasi oggetto 3D (`oip.box`, pezzi lavorati, cilindri) rilasciato dall'alto da uno *Spawner* o dal braccio **Two-Axis Pick & Place** cade **fisicamente dentro la cassetta**, si appoggia sul fondo interno ed è trasportato lungo le rulliere o i nastri insieme alla cassetta.
2. **Contenimento Liquidi (`hasLiquid` + `liquidFill`)**:
   * Attivando il parametro **`Contains liquid` (`hasLiquid = true`)**, l'interno della cassetta mostra e simula un volume di liquido semitrasparente regolabile dal `5%` al `95%` tramite **`Liquid level` (`liquidFill`)**.
3. **Impilabilità automatica (`nestDepth: 0.015 m`)**:
   * Sovrapponendo due cassette Euro KLT, il piedino inferiore della cassetta superiore si incastra automaticamente di `15 mm` dentro il bordo superiore di quella sottostante.

## Parametri Configurabili

| Parametro | Tipo | Default | Range | Descrizione |
| :--- | :--- | :---: | :---: | :--- |
| `mass` | `number` | `2.2 kg` | `0.5 .. 60 kg` | Massa fisica della cassetta (da incrementare se pre-riempita di liquido). |
| `color` | `color` | `#c8c4bc` | `#rrggbb` | Colore della scocca in plastica (default grigio chiaro industriale KLT). |
| `hasLiquid` | `boolean` | `false` | — | Abilita il volume di liquido all'interno della cavità della cassetta. |
| `liquidFill` | `number` | `65 %` | `5 % .. 95 %` | Percentuale di riempimento del liquido interno (visibile quando `hasLiquid = true`). |
| `contentsTag` | `string` | `""` | testo | Attributo di prodotto (`attribute: true`) leggibile da sensori/scanner lungo la linea. |
