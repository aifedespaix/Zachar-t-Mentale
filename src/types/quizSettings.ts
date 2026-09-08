export interface QuizSettings {
  similarityThreshold: number
  /**
   * Draw the answer's shape (« B____ d__ ____ ») on the card itself, not only
   * inside the answer dialog. It is a peek at the question's difficulty from
   * the graph, so it stays optional.
   */
  lengthGuideEnabled: boolean
  /**
   * Colour each letter green/red AS IT IS TYPED, rather than only once the
   * answer is submitted.
   *
   * Off by default, and deliberately so: live grading turns a recall question
   * into a letter-by-letter oracle you can brute-force one keystroke at a
   * time, which is exactly the effort the card is supposed to make you spend.
   * On validation the same colours explain the mistake without having handed
   * out the answer first.
   */
  liveLetterFeedback: boolean
}

export const DEFAULT_QUIZ_SETTINGS: QuizSettings = {
  similarityThreshold: 100,
  lengthGuideEnabled: true,
  liveLetterFeedback: false,
}
