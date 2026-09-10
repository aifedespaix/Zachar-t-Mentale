Contexte :
La fonctionnalité de synchronisation PocketBase vient d'être fusionnée. L'application gère des cartes mentales (cours et prises de notes). Nous avons un workflow où un professeur et un élève partagent des fichiers via cette synchro.

Objectif :
Je veux que tu implémentes deux tâches distinctes pour finaliser l'UX de ce workflow.

Tâche 1 : Corriger l'action "Dupliquer" pour éviter les conflits de synchronisation

Le problème : Actuellement, si on utilise l'action générique "Dupliquer" sur une carte mentale qui est déjà synchronisée avec PocketBase, la copie locale conserve les métadonnées de synchronisation (ID distant, statut de synchro, etc.). Cela crée un risque de corruption où deux fichiers locaux pointent vers le même enregistrement distant.

Ce que tu dois faire : Trouve la fonction qui gère l'action "Dupliquer". Modifie-la pour que, lors de la copie des données, toutes les métadonnées liées à la synchronisation soient purgées/supprimées. Le duplicata doit devenir un fichier 100% local, vierge de tout historique de synchro, prêt à être approprié par l'élève.

Tâche 2 : Ajouter un bouton de Synchronisation Manuelle

Le problème : L'utilisateur a besoin de forcer la synchronisation (pull + push) à des moments clés (ex: le matin en se connectant au réseau).

Ce que tu dois faire :

Identifie la méthode dans le store de synchro (useSyncStore ou équivalent) qui déclenche une synchronisation complète.

Ajoute un bouton "Synchroniser" dans l'interface (idéalement dans la barre latérale ou la barre de navigation supérieure, là où c'est le plus logique ergonomiquement) (au passage, rajotue des tooltip sur les icones de la abrre latérale et je varrai bien cette barre de boutons plutot en bas de la sidebar plutot qu'en entête, et repense l'agencesement ordre / espacement des boutons pour une meilleure cohérence / ux.

États visuels : Le bouton doit avoir un état de chargement (icône qui tourne ou texte "Synchronisation...") pendant le processus pour que l'utilisateur sache que ça travaille.

Gestion des erreurs : Si la synchro échoue (pas d'internet, serveur inaccessible), empêche l'application de crasher et affiche une notification/toast ou un message d'erreur clair et discret.
