export type Letter = 'A' | 'B' | 'C' | 'D'

export interface Question {
  id: string
  number: number
  subject: string | null
  subject_status: 'unlabeled' | 'range' | 'reviewed'
  stem: string
  options: [string, string, string, string]
  answers: Letter[]
  free_point: boolean
  answer_note: string | null
  override_reason: string | null
  images: string[]
  explanation: string | null
  explanation_status: 'none' | 'unreviewed' | 'reviewed'
  valid: boolean
  issues: string[]
}

export interface ExamFile {
  exam: { id: string; year: number; session: number | null; paper: string }
  problems: string[]
  questions: Question[]
}

export interface PaperInfo {
  id: string
  year: number
  session: number | null
  paper: string
  file: string
  count: number
}

export interface Index {
  subjects: Record<string, string>
  papers: PaperInfo[]
}
