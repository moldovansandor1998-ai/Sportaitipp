import type { LandingLocale } from './content';
import { studioCopy } from '@/lib/studio-copy';
import styles from './LandingPage.module.css';
const copy: Record<LandingLocale, { title: string; note: string; film: string; tour: string }> = {
  en: { title: 'See your ideas come to life.', note: 'Two 30-second promotional films · English · AI-generated showcase', film: 'Cinematic models', tour: 'Inside the creative studio' },
  hu: { title: 'Nézd meg, ahogy életre kel az ötlet.', note: 'Két 30 másodperces bemutató · Angol nyelven · AI-generált promóció', film: 'Filmszerű AI-modellek', tour: 'Az alkotóstúdió belülről' },
  ro: { title: 'Vezi cum ideile prind viață.', note: 'Două filme promoționale de 30 de secunde · Engleză · Prezentare generată cu AI', film: 'Modele cinematografice', tour: 'În studioul creativ' },
  it: { title: 'Guarda le tue idee prendere vita.', note: 'Due video promozionali di 30 secondi · Inglese · Presentazione generata con AI', film: 'Modelli cinematografici', tour: 'Dentro lo studio creativo' },
  de: { title: 'Sieh, wie Ideen lebendig werden.', note: 'Zwei 30-Sekunden-Werbefilme · Englisch · KI-generierte Präsentation', film: 'Filmreife KI-Modelle', tour: 'Einblick ins Kreativstudio' },
  fr: { title: 'Voyez vos idées prendre vie.', note: 'Deux films promotionnels de 30 secondes · Anglais · Démonstration générée par IA', film: 'Modèles cinématographiques', tour: 'Dans le studio créatif' },
  sk: { title: 'Pozri, ako nápady ožívajú.', note: 'Dva 30-sekundové propagačné filmy · Angličtina · Prezentácia vytvorená AI', film: 'Filmové AI modely', tour: 'V kreatívnom štúdiu' },
  pl: { title: 'Zobacz, jak pomysły ożywają.', note: 'Dwa 30-sekundowe filmy promocyjne · Angielski · Prezentacja wygenerowana przez AI', film: 'Filmowe modele AI', tour: 'W studiu kreatywnym' },
};
export default function VideoShowcase({ locale }: { locale: LandingLocale }) {
  const c = copy[locale];
  return <section id="showcase" className={`${styles.section} ${styles.showcase}`} aria-labelledby="showcase-heading">
    <div className={styles.showcaseIntro}><p className={styles.eyebrow}>{studioCopy[locale].showcase}</p><h2 id="showcase-heading">{c.title}</h2><p>{c.note}</p></div>
    <div className={styles.showcaseGrid}>{[['cinematic-models', c.film], ['product-studio', c.tour]].map(([file, title], index) => <figure key={file}>
      <div className={styles.showcaseVideo}><video controls playsInline preload="none" poster={`/media/showcase/${file}.jpg`} aria-label={title}>
        <source src={`/media/showcase/${file}.mp4`} type="video/mp4" />
        <a href={`/media/showcase/${file}.mp4`}>{title}</a>
      </video></div>
      <figcaption><span>0{index + 1}</span><strong>{title}</strong><span>00:30</span></figcaption>
    </figure>)}</div>
  </section>;
}
