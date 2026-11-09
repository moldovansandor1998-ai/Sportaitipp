// Customer-facing scope disclosure. This is not a claim about guaranteed margins.
export const creationAvailability = {
  hu: 'Egy saját kép szerkesztése: 70 kredit. Más módok csak ellenőrzött árajánlattal érhetők el. A modelltréning, külön modellhang és többlépéses feldolgozás ügyfeleknek még nem elérhető. Minden indítás előtt látod és jóváhagyod a díjat.',
  en: 'Edit one uploaded image: 70 credits. Other modes require a verified quote. Model training, separate model voices and multi-step processing are not yet available to customers. You see and approve the price before each start.',
  ro: 'Editarea unei imagini încărcate: 70 de credite. Alte moduri necesită o ofertă verificată. Antrenarea modelelor, vocile separate și procesarea în mai multe etape nu sunt încă disponibile clienților. Vezi și aprobi prețul înainte de fiecare pornire.',
  it: 'Modifica di una singola immagine caricata: 70 crediti. Le altre modalità richiedono un preventivo verificato. Addestramento, voci separate e processi in più fasi non sono ancora disponibili ai clienti. Il prezzo va confermato prima di ogni avvio.',
  de: 'Ein hochgeladenes Bild bearbeiten: 70 Credits. Andere Modi erfordern ein geprüftes Preisangebot. Modelltraining, separate Modellstimmen und mehrstufige Verarbeitung sind für Kunden noch nicht verfügbar. Vor jedem Start wird der Preis angezeigt und bestätigt.',
  fr: 'Modifier une image importée : 70 crédits. Les autres modes nécessitent un devis vérifié. L’entraînement, les voix séparées et les traitements en plusieurs étapes ne sont pas encore disponibles aux clients. Le prix est affiché et confirmé avant chaque lancement.',
  sk: 'Úprava jedného nahraného obrázka: 70 kreditov. Ostatné režimy vyžadujú overenú cenu. Tréning modelov, samostatné hlasy a viacstupňové spracovanie zatiaľ nie sú dostupné zákazníkom. Pred každým spustením cenu uvidíte a potvrdíte.',
  pl: 'Edycja jednego przesłanego obrazu: 70 kredytów. Inne tryby wymagają zweryfikowanej wyceny. Trening modeli, osobne głosy i przetwarzanie wieloetapowe nie są jeszcze dostępne dla klientów. Cena jest widoczna i zatwierdzana przed każdym uruchomieniem.',
} as const;

// Billing-specific copy stays separate from the shared tools dictionary.
export const creationPricingText = {
  "hu": {
    "confirm": "Az alkotás díja {p0} kredit. Elindítod?",
    "cancelled": "Az alkotás nem indult el; nem foglaltunk kreditet.",
    "costUnavailable": "Ehhez a módhoz még nincs ellenőrzött teljes költség. Kreditfoglalás nem történt."
  },
  "en": {
    "confirm": "This creation costs {p0} credits. Start?",
    "cancelled": "The creation was not started; no credits were reserved.",
    "costUnavailable": "The complete cost of this mode is not verified yet. No credits were reserved."
  },
  "ro": {
    "confirm": "Această creație costă {p0} credite. Începi?",
    "cancelled": "Creația nu a început; nu au fost rezervate credite.",
    "costUnavailable": "Costul complet al acestui mod nu este încă verificat. Nu au fost rezervate credite."
  },
  "it": {
    "confirm": "Questa creazione costa {p0} crediti. Avviare?",
    "cancelled": "La creazione non è stata avviata; nessun credito è stato riservato.",
    "costUnavailable": "Il costo completo di questa modalità non è ancora verificato. Nessun credito è stato riservato."
  },
  "de": {
    "confirm": "Diese Erstellung kostet {p0} Credits. Starten?",
    "cancelled": "Die Erstellung wurde nicht gestartet; es wurden keine Credits reserviert.",
    "costUnavailable": "Die vollständigen Kosten dieses Modus sind noch nicht geprüft. Es wurden keine Credits reserviert."
  },
  "fr": {
    "confirm": "Cette création coûte {p0} crédits. Démarrer ?",
    "cancelled": "La création n’a pas démarré ; aucun crédit n’a été réservé.",
    "costUnavailable": "Le coût complet de ce mode n’est pas encore vérifié. Aucun crédit n’a été réservé."
  },
  "sk": {
    "confirm": "Táto tvorba stojí {p0} kreditov. Spustiť?",
    "cancelled": "Tvorba sa nespustila; žiadne kredity neboli rezervované.",
    "costUnavailable": "Úplné náklady tohto režimu ešte nie sú overené. Žiadne kredity neboli rezervované."
  },
  "pl": {
    "confirm": "Ta praca kosztuje {p0} kredytów. Rozpocząć?",
    "cancelled": "Praca nie została rozpoczęta; nie zarezerwowano kredytów.",
    "costUnavailable": "Pełny koszt tego trybu nie został jeszcze zweryfikowany. Nie zarezerwowano kredytów."
  }
} as const;
