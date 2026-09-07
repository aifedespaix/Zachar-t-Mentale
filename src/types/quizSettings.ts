export interface QuizSettings {
  similarityThreshold: number
  lengthGuideEnabled: boolean
}

export const DEFAULT_QUIZ_SETTINGS: QuizSettings = {
  similarityThreshold: 100,
  lengthGuideEnabled: true,
}
