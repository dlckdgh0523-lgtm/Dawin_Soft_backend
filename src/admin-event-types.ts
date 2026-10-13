// Writers take the same transaction lock before inserting these audit events.
// This keeps the durable SSE cursor in commit order, including worker writes.
export const adminEventActions = ['article.save','article.request-review','article.approve','article.reject','article.cancel-approval','article.cancel-schedule','article.publish','article.schedule','article.published','article.unpublish','article.archive','article.trash','article.delete','article.source-changed','editorial.proposal-ready'] as const;
export const adminEventLabels:Record<string,string> = {
 'article.request-review':'글 검토 요청','article.approve':'글 승인 완료','article.reject':'글 검토 반려',
 'article.cancel-approval':'글 승인 취소','article.cancel-schedule':'예약 발행 취소','article.publish':'글 발행 등록',
 'article.schedule':'예약 발행 등록','article.published':'글 공개 완료','article.source-changed':'출처 변경 · 다시 검토 필요',
 'editorial.proposal-ready':'AI 초안 제안 도착'
};
