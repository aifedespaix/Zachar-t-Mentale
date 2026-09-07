import { mindMapBaseName } from './paths'

const APP_NAME = "Zachar't Mentale"

/** The window title: the app name alone, or with the open file's name appended. */
export function windowTitleFor(filePath: string | null): string {
  if (!filePath) return APP_NAME
  return `${APP_NAME} - ${mindMapBaseName(filePath)}`
}
