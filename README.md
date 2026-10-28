# OIP Custom Parts (`oip-custom-parts`)

Libreria ufficiale dei componenti aggiuntivi personalizzati (**Custom Parts** & **Parts Shelf**) sviluppati per **Open Industry Project (OIP)**.

Questo repository è strutturato per funzionare in **doppio formato**:
1. **Direttamente come `Parts Shelf` nativa di Open Industry Project Desktop** (`Catalog → Shelf`): ogni sottocartella `user.<nome>/` contiene `manifest.json` e `behavior.js` ed è immediatamente utilizzabile e aggiornabile da qualsiasi progetto OIP.
2. **Come archivio di pacchetti `.oippart` pronti all'importazione** nella cartella [`dist/`](./dist), importabili con un clic tramite **Parts → ⤒ Import part** sia su OIP Desktop sia su OIP Web.

---

## 📦 Catalogo Componenti Inclusi

| ID Componente | Nome | Categoria | Sorgente Cartella | Pacchetto `.oippart` | Descrizione Sintetica |
| :--- | :--- | :---: | :--- | :--- | :--- |
| **`user.filling-tank`** | **Filling Tank** | `Equipment` | [`user.filling-tank/`](./user.filling-tank) | [`dist/user.filling-tank.oippart`](./dist/user.filling-tank.oippart) | Serbatoio industriale graduato con valvole di carico/scarico (`Fill`/`Drain`), sensori di livello min/max (`5%`/`95%`), misura analogica `0–100%` e display digitale. |
| **`user.two-axis-pick-and-place`** | **Two-Axis Pick & Place** | `Equipment` | [`user.two-axis-pick-and-place/`](./user.two-axis-pick-and-place) | [`dist/user.two-axis-pick-and-place.oippart`](./dist/user.two-axis-pick-and-place.oippart) | Manipolatore cartesiano Pick & Place a 2 assi (`X` orizzontale, `Z` verticale a doppio stelo di guida) con ventosa a vuoto, sensore presenza pezzo (`Detected`) e 3 modalità PLC (`digital`, `analog`, `bistable`). |

---

## 🚀 Come usare i componenti in Open Industry Project

### Metodo 1 — Tramite la scheda `Shelf` (Consigliato su OIP Desktop)
1. Apri **Open Industry Project** → pannello **Parts** → scheda **Shelf**.
2. La cartella `~/Documents/Open Industry Project/Parts Shelf` è già collegata a questo repository (oppure clicca **Change folder…** e seleziona la cartella locale `oip-custom-parts`).
3. Trascina direttamente il componente nella scena 3D; quando aggiorni un componente nel repository (`git pull`), OIP ti mostrerà automaticamente il badge **Update available**.

### Metodo 2 — Importazione diretta file `.oippart`
1. Nel pannello **Parts**, clicca su **⤒ Import part**.
2. Seleziona il file `.oippart` desiderato dalla cartella [`dist/`](./dist).

---

## 🛠️ Come aggiungere un nuovo componente al repository

1. Crea una nuova cartella con prefisso `user.<nome-componente>/` contenente `part.js` (oppure `manifest.json` + `behavior.js`), `description.txt` e `README.md`.
2. Esegui lo script di validazione e impacchettamento:
   ```bash
   ./scripts/pack-parts.sh
   ```
   Lo script compila eventuali `part.js` tramite `build-parts`, verifica l'assenza di errori/warning con `check-part` e genera il relativo pacchetto `.oippart` in `dist/`.
3. Esegui commit e push su GitHub:
   ```bash
   git add .
   git commit -m "Add user.<nome-componente>"
   git push
   ```
