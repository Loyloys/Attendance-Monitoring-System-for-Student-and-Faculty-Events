export function serializeEvaluationForm(form) {
  return {
    id: form._id,
    title: form.title,
    eventId: form.eventId,
    questions: form.questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      type: question.type,
      required: question.required,
    })),
    active: form.active,
    createdAt: new Date(form.createdAt).toISOString(),
    updatedAt: new Date(form.updatedAt).toISOString(),
  };
}

export function serializeEvaluationResponse(response, user) {
  return {
    id: response._id,
    formId: response.formId,
    eventId: response.eventId,
    attendeeId: user.accountId,
    attendeeName: user.profile.displayName,
    role: user.profile.role === 'faculty' ? 'Faculty' : 'Student',
    answers: response.answers,
    submittedAt: new Date(response.submittedAt).toISOString(),
  };
}
