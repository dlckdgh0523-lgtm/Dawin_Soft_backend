import {esc} from './types';

const cmsContent = [
 {title:'새로운 시작을 함께합니다.',date:'2026.10.07',category:'스튜디오 소식',body:'작은 아이디어에서 시작해, 실제로 사용하는 서비스로 이어갑니다.'},
 {title:'콘텐츠를 직접 관리하세요.',date:'2026.10.05',category:'서비스 안내',body:'공지와 소식을 담당자가 직접 수정하고, 공개 화면에서 확인할 수 있습니다.'},
 {title:'모바일에서도 자연스럽게.',date:'2026.10.02',category:'업데이트',body:'화면의 크기가 달라져도, 중요한 정보와 문의 동선은 명확하게.'},
];
const tasks = [
 {title:'모바일 화면 검토',detail:'주요 화면 · 사용자 흐름',status:'대기',tag:'화면 설계'},
 {title:'연동 범위 확인',detail:'필요한 데이터 정리',status:'대기',tag:'요구사항'},
 {title:'콘텐츠 관리 구현',detail:'편집 · 미리보기',status:'진행',tag:'개발'},
 {title:'문의 동선 점검',detail:'입력 항목 · 오류 안내',status:'진행',tag:'검증'},
 {title:'기능 목록 정리',detail:'범위와 우선순위 확인',status:'완료',tag:'기획'},
];
const geoQuestions = [
 {question:'어떤 기능을 맡길 수 있나요?',answer:'홈페이지와 관리자 CMS, 업무 시스템, AI 기능과 자동화, 검색 대응을 상담할 수 있습니다. 필요한 기능과 운영 조건을 먼저 확인해 개발 범위를 정합니다.',sources:[{title:'서비스 안내',path:'/services/website-development',note:'홈페이지와 콘텐츠 관리 범위'},{title:'진행 과정',path:'/process',note:'상담부터 범위 합의까지'}]},
 {question:'기존 홈페이지도 개선하나요?',answer:'기존 화면과 관리 환경을 확인하고 콘텐츠 관리, 문의 동선, 검색 구조 등 필요한 부분의 개선을 검토합니다. 이전 여부와 작업 범위는 현재 환경을 살펴본 뒤 협의합니다.',sources:[{title:'홈페이지·CMS',path:'/services/website-development',note:'기존 홈페이지 개선과 운영 관리'},{title:'검색 대응',path:'/services/seo-geo',note:'페이지 정보와 질문·답변 정리'}]},
 {question:'개발 후 운영은 어떻게 하나요?',answer:'검수를 거쳐 배포하고 관리 방법과 인계 자료를 전달합니다. 오픈 후 수정과 추가 개발은 합의한 범위와 보수 기준에 따라 진행합니다.',sources:[{title:'진행 과정',path:'/process',note:'배포와 운영 인계'},{title:'수정·보수 기준',path:'/support-policy',note:'오픈 후 수정과 추가 범위'}]},
];
const tabs = [['cms','홈페이지·CMS'],['board','업무 관리'],['ai','AI 업무 도구'],['geo','SEO·GEO']];

// The sample content is rendered on the server so the first preview survives script failure.
export function heroSimulation(){
 const first=cmsContent[0];
 return `<div class="hero-demo-wrap"><div class="demo-intro"><span>만들 수 있는 소프트웨어, 직접 경험해 보세요.</span><span class="sample-label">예시 화면</span></div>
 <div class="hero-brand-motion"><div class="demo-window" id="hero-demo">
 <div class="window-bar"><div class="window-dots" aria-hidden="true"><i></i><i></i><i></i></div><span>DANWI / PLAYGROUND</span><span class="demo-local">기능 미리보기</span></div>
 <div class="demo-tabs" role="tablist" aria-label="소프트웨어 기능 미리보기">${tabs.map(([id,label],i)=>`<button type="button" id="tab-${id}" role="tab" aria-selected="${i===0}" aria-controls="panel-${id}" tabindex="${i===0?0:-1}" data-tab="${id}" disabled>${label}</button>`).join('')}</div>
 <div class="demo-panels">
 <div class="demo-panel cms-panel" id="panel-cms" role="tabpanel" aria-labelledby="tab-cms" tabindex="0"><div class="cms-editor"><div class="panel-kicker">콘텐츠 관리</div><h3>소식을 선택해 보세요.</h3><div id="cms-choices">${cmsContent.map((c,i)=>`<button type="button" class="cms-choice" data-content="${i}" aria-pressed="${i===0}" disabled><span>${esc(c.category)}</span><strong>${esc(c.title)}</strong></button>`).join('')}</div><div class="cms-tip"><span aria-hidden="true">↳</span>선택한 콘텐츠가<br>미리보기에 반영됩니다.</div></div><div class="cms-preview"><div class="preview-nav"><strong>UNIT STUDIO</strong><span>About &nbsp; Work</span></div><div class="preview-cover"><span>STUDIO JOURNAL</span><div class="preview-unit" aria-hidden="true"><i></i><i></i><i></i></div><p>작은 시작.<br>새로운 연결.</p></div><div class="preview-article"><span id="cms-date">${first.date}</span><h3 id="cms-title">${first.title}</h3><p id="cms-body">${first.body}</p></div><div class="preview-footer"><span>홈페이지 미리보기</span><span id="cms-synced" role="status">콘텐츠 반영됨</span></div></div></div>
 <div class="demo-panel board-panel" id="panel-board" role="tabpanel" aria-labelledby="tab-board" tabindex="0" hidden><div class="demo-title-row"><div><span class="panel-kicker">업무 관리 시스템</span><h3>오늘의 작업 보드</h3></div><span class="sample-label">샘플 데이터</span></div><div class="board-filters" role="group" aria-label="작업 필터">${['all','대기','진행','완료'].map((s,i)=>`<button type="button" data-filter="${s}" aria-pressed="${i===0}" disabled>${i===0?'전체':s}</button>`).join('')}</div><div class="kanban" id="kanban"></div><p class="demo-helper" id="board-summary" role="status">전체 5개 작업을 표시합니다.</p></div>
 <div class="demo-panel ai-panel" id="panel-ai" role="tabpanel" aria-labelledby="tab-ai" tabindex="0" hidden><div class="demo-title-row"><div><span class="panel-kicker">문서 정리 도구</span><h3>회의 내용을, 다음 할 일로.</h3></div><span class="sample-label">시뮬레이션</span></div><div class="ai-source"><span>입력 문서 · 회의 메모</span><p>홈페이지의 소식은 담당자가 직접 수정하면 좋겠습니다. 문의 내역을 한곳에서 확인하고, 먼저 모바일 주요 화면을 검토하기로 했습니다.</p></div><div class="ai-steps" aria-label="예시 처리 단계"><span>01 문서 확인</span><span>02 내용 요약</span><span>03 업무 정리</span></div><div id="ai-result" class="ai-result" aria-live="polite"><p>예시를 실행하면 요약과 할 일이 순서대로 나타납니다.</p></div><div class="ai-footer"><button type="button" class="demo-run" id="ai-run" disabled>예시 실행</button><span>준비된 예시 문서로 보여주는 화면입니다.</span></div></div>
 <div class="demo-panel geo-panel" id="panel-geo" role="tabpanel" aria-labelledby="tab-geo" tabindex="0" hidden><div class="demo-title-row"><div><span class="panel-kicker">검색과 AI 답변을 위한 정보</span><h3>질문에 맞는 정보와 근거를.</h3></div><span class="sample-label">시뮬레이션</span></div><label class="geo-question" for="geo-question">고객이 궁금한 질문<select id="geo-question" disabled>${geoQuestions.map((q,i)=>`<option value="${i}">${esc(q.question)}</option>`).join('')}</select></label><div class="geo-information" aria-label="답변에 참고하는 정보">${firstGeoSources()}</div><div class="geo-steps" aria-label="예시 정보 정리 단계"><span>01 정보 확인</span><span>02 답변 구성</span><span>03 출처 연결</span></div><div id="geo-result" class="geo-result" aria-live="polite"><p>예시를 실행하면 관련 정보로 답변을 구성하고 출처를 연결합니다.</p></div><div class="geo-footer"><button type="button" class="demo-run" id="geo-run" disabled>정리 예시 보기</button><span>답변 구성 예시이며 실제 검색·AI 노출 결과는 아닙니다.</span></div></div>
 </div></div></div><div class="demo-caption"><span class="demo-caption-line" aria-hidden="true"></span><p>화면에서 멈추지 않고,<br><strong>실제로 사용하는 기능까지.</strong></p><span class="unit-index">01 / 04</span></div><noscript><p class="demo-noscript">콘텐츠 미리보기입니다. 예시 기능은 자바스크립트를 켜면 사용할 수 있습니다.</p></noscript><script type="application/json" id="hero-sample-data">${JSON.stringify({cmsContent,tasks,geoQuestions}).replace(/</g,'\\u003c')}</script></div>`;
}
function firstGeoSources(){return geoQuestions[0].sources.map(s=>`<div><span>참고 정보</span><strong>${esc(s.title)}</strong><p>${esc(s.note)}</p></div>`).join('');}
