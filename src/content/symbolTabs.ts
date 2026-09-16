import { FlaskConical, Sigma } from 'lucide-react'
import type { SymbolTab } from '../types/symbolBand'
import { SCIENCES_FAMILIES, SYMBOL_FAMILIES } from './symbolSets'

/**
 * Les onglets du bandeau.
 *
 * Un onglet est un jeu de familles sous un nom et une icône, et le bandeau n'en
 * montre qu'un à la fois. C'est le remplacement de ce qui existait avant, où
 * l'éditeur retenait une LANGUE et où chaque bloc portait sa propre palette : le
 * besoin est le même — « quels caractères m'aide-t-on à écrire en ce moment ? » —
 * mais il est posé sur le bandeau, donc **aucun bloc n'a plus rien à retenir**.
 *
 * Deux conséquences, et elles comptent :
 *
 *  - Le pied du bloc disparaît, et avec lui le décalage de 120–190 px qu'il
 *    provoquait à chaque changement de bloc actif. C'était le dernier.
 *  - L'onglet ouvert est un réglage d'AFFICHAGE : il se retient entre deux
 *    ouvertures de la modale et entre deux lancements (voir
 *    `persistence/bandTab`), et il ne part jamais dans un fichier.
 *
 * ⚠️ **Les onglets de langue (Anglais / Espagnol / Français) ne sont pas encore
 * ici.** Leur contenu est prêt — `languageHelp` porte déjà les groupes — mais les
 * ajouter exige de retirer la palette d'accents du pied du bloc *dans le même
 * passage* : sinon les mêmes caractères existeraient à deux endroits. C'est
 * l'étape suivante, avec la migration des tests qui vont avec.
 */
export const SYMBOL_TABS: SymbolTab[] = [
  {
    id: 'maths',
    label: 'Mathématiques',
    icon: Sigma,
    families: SYMBOL_FAMILIES,
  },
  {
    id: 'sciences',
    label: 'Sciences',
    icon: FlaskConical,
    families: SCIENCES_FAMILIES,
  },
]

/** L'onglet ouvert par défaut, et celui qu'on retrouve quand le réglage est illisible. */
export const DEFAULT_TAB: SymbolTab['id'] = 'maths'
