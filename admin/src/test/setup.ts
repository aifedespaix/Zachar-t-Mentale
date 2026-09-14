import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

/**
 * Le DOM est vidé entre deux tests, EXPLICITEMENT.
 *
 * Testing Library le fait déjà d'elle-même quand elle trouve un `afterEach`
 * global. C'est le cas ici, donc cette ligne ne répare rien aujourd'hui : elle
 * rend simplement la garantie visible et indépendante de cette détection, parce
 * que le symptôme d'un nettoyage absent — `getByText` qui trouve deux fois le
 * même nœud — se lit comme un bug de l'arborescence et non comme un problème de
 * configuration.
 *
 * ⚠️ Ce fichier n'a d'effet que si la suite est lancée avec le vitest de CE
 * dossier : les matchers de `jest-dom` s'enregistrent dans l'instance d'`expect`
 * du paquet qui les charge. Lancé avec le binaire de la racine, tout ce fichier
 * s'exécute sans que `toBeInTheDocument` existe côté assertions. D'où
 * `"test:admin": "cd admin && bun run test"` dans le package.json racine, qui
 * délègue au package.json d'ici plutôt que d'appeler `vitest` directement.
 */
afterEach(cleanup)
