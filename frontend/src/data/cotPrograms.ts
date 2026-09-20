export const COT_PROGRAMS = [
  { code: 'BSIT', name: 'Bachelor of Science in Information Technology' },
  { code: 'BSEMC', name: 'Bachelor of Science in Entertainment and Multimedia Computing' },
  { code: 'BSAT', name: 'Bachelor of Science in Automotive Technology' },
  { code: 'BSFT', name: 'Bachelor of Science in Food Technology' },
  { code: 'BSET', name: 'Bachelor of Science in Electronics Technology' },
] as const;

export type CotProgramCode = (typeof COT_PROGRAMS)[number]['code'];

export const COT_PROGRAM_CODES = COT_PROGRAMS.map(program => program.code) as CotProgramCode[];

export function isApprovedCotProgram(value: string): value is CotProgramCode {
  return COT_PROGRAM_CODES.includes(value as CotProgramCode) || COT_PROGRAMS.some(program => program.name === value);
}
