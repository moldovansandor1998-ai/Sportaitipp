/** X's lang:hu is only a hint; reject posts without clear Hungarian text. */
export function looksHungarian(text: string) {
  const body = text.replace(/https?:\/\/\S+|[@#][^\s]+/g, " ").toLocaleLowerCase("hu-HU");
  const words = body.match(/[a-záéíóöőúüű]+/gu) ?? [];
  if (words.length < 5) return false;
  const markers = new Set(["hogy", "nem", "vagy", "van", "vagyok", "nekem", "szerintem",
    "magyar", "most", "miért", "és", "ezt", "egy", "akkor", "amikor", "lehet",
    "nagyon", "csak", "már", "még", "lenne", "tudom", "kéne", "ilyen", "olyan",
    "igen", "valaki", "így", "úgy", "mert", "sem", "lesz", "volt", "után",
    "előtt", "hol", "mikor", "aki", "akit", "ettől", "szeretem", "ennek",
    "ez", "az", "meg", "itt", "ott", "minden", "mi", "te", "neked"]);
  const matches = new Set(words.filter(word => markers.has(word))).size;
  const accented = (body.match(/[áéíóöőúüű]/gu) ?? []).length;
  return matches >= 2 || (matches >= 1 && accented >= 2);
}
