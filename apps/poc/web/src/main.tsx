import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Home } from './Home';
import { PlanShell } from './plan/PlanShell';
import { PlanList } from './plan/PlanList';
import { PlanTemplates } from './plan/PlanTemplates';
import { PlanBasisTemplates } from './plan/PlanBasisTemplates';
import { PlanEditor } from './plan/PlanEditor';
import { PlanRhwpEditor } from './plan/PlanRhwpEditor';
import { SitShell } from './sit/SitShell';
import { SitDashboard } from './sit/SitDashboard';
import { SitNew } from './sit/SitNew';
import { SitSop } from './sit/SitSop';
import { SitDispatch } from './sit/SitDispatch';
import { SitBoard } from './sit/SitBoard';
import { SitJournal } from './sit/SitJournal';
import { SitStatic } from './sit/SitStatic';
import { Mobile } from './sit/Mobile';
import { font } from './ui';

document.body.style.margin = '0';
document.body.style.fontFamily = font;
document.body.style.background = '#f4f5f6';
document.body.style.color = '#1f2933';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/plan" element={<PlanShell />}>
          <Route index element={<PlanList />} />
          <Route path="templates" element={<PlanTemplates />} />
          <Route path="basis-templates" element={<PlanBasisTemplates />} />
          <Route path=":id" element={<PlanEditor />} />
          <Route path=":id/editor" element={<PlanRhwpEditor />} />
        </Route>
        <Route path="/sit" element={<SitShell />}>
          <Route index element={<SitDashboard />} />
          <Route path="new" element={<SitNew />} />
          <Route path="data" element={<SitStatic kind="data" />} />
          <Route path="settings" element={<SitStatic kind="settings" />} />
          <Route path=":id" element={<SitDashboard />} />
          <Route path=":id/sop" element={<SitSop />} />
          <Route path=":id/dispatch" element={<SitDispatch />} />
          <Route path=":id/board" element={<SitBoard />} />
          <Route path=":id/journal" element={<SitJournal />} />
        </Route>
        <Route path="/m/:assigneeId" element={<Mobile />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
