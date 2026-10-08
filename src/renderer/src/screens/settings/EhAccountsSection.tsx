import { useEffect, useState } from 'react';
import Section from './Section';
import Toggle from '../../components/Toggle';
import type { ExAccountsResult } from '@shared/ipc';

export default function EhAccountsSection(): JSX.Element {
  const [exAcc, setExAcc] = useState<ExAccountsResult>({ accounts: [], currentId: 0 });
  const [exName, setExName] = useState('');
  const [exMemberId, setExMemberId] = useState('');
  const [exPassHash, setExPassHash] = useState('');
  const [exIgneous, setExIgneous] = useState('');
  const [exNotice, setExNotice] = useState<string | null>(null);
  const [pwUser, setPwUser] = useState('');
  const [pwPass, setPwPass] = useState('');
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);
  const [ckMember, setCkMember] = useState('');
  const [ckHash, setCkHash] = useState('');
  const [ckIgneous, setCkIgneous] = useState('');
  const [ckVerify, setCkVerify] = useState(true);
  const [ckMsg, setCkMsg] = useState<string | null>(null);
  const [ckBusy, setCkBusy] = useState(false);
  const [ckText, setCkText] = useState('');
  const [ignMsg, setIgnMsg] = useState<string | null>(null);
  const [ignBusy, setIgnBusy] = useState(false);

  useEffect(() => {
    window.api.getExAccounts().then(setExAcc);
  }, []);

  // Auto-detect E-Hentai cookies from the clipboard on open (like JHenTai).
  useEffect(() => {
    navigator.clipboard
      ?.readText?.()
      .then((t) => {
        if (!t) return;
        window.api
          .parseCookieText(t)
          .then((p) => {
            if (p.ipbMemberId || p.ipbPassHash || p.igneous) {
              if (p.ipbMemberId) setCkMember(p.ipbMemberId);
              if (p.ipbPassHash) setCkHash(p.ipbPassHash);
              if (p.igneous) setCkIgneous(p.igneous);
            }
          })
          .catch(() => {});
      })
      .catch(() => {});
  }, []);

  return (
    <Section title="Аккаунты ExHentai">
      <div className="row">
        <label>Вход по куки (E-Hentai/ExHentai):</label>
      </div>
      <div className="row">
        <textarea
          className="cookie-input"
          rows={2}
          value={ckText}
          placeholder="Вставь куки (например, из буфера обмена) и нажми «Распознать»"
          onChange={(e) => setCkText(e.target.value)}
        />
      </div>
      <div className="row">
        <button
          onClick={async () => {
            if (!ckText.trim()) return;
            const p = await window.api.parseCookieText(ckText);
            if (p.ipbMemberId) setCkMember(p.ipbMemberId);
            if (p.ipbPassHash) setCkHash(p.ipbPassHash);
            if (p.igneous) setCkIgneous(p.igneous);
            setCkText('');
          }}
        >
          Распознать
        </button>
        <button
          onClick={async () => {
            try {
              const t = await navigator.clipboard?.readText?.();
              if (t) {
                const p = await window.api.parseCookieText(t);
                if (p.ipbMemberId) setCkMember(p.ipbMemberId);
                if (p.ipbPassHash) setCkHash(p.ipbPassHash);
                if (p.igneous) setCkIgneous(p.igneous);
              }
            } catch {
              /* clipboard blocked */
            }
          }}
        >
          📋 Из буфера
        </button>
        <Toggle className="filter-check" checked={ckVerify} onChange={setCkVerify}>
          Проверять вход
        </Toggle>
      </div>
      <div className="row">
        <label>ipb_member_id</label>
        <input className="text-input" value={ckMember} onChange={(e) => setCkMember(e.target.value)} style={{ width: 180 }} />
      </div>
      <div className="row">
        <label>ipb_pass_hash</label>
        <input className="text-input" value={ckHash} onChange={(e) => setCkHash(e.target.value)} style={{ width: 220 }} />
      </div>
      <div className="row">
        <label>igneous (для ExHentai, необязательно)</label>
        <input className="text-input" value={ckIgneous} onChange={(e) => setCkIgneous(e.target.value)} style={{ width: 220 }} />
      </div>
      <div className="row">
        <button
          disabled={ckBusy}
          onClick={async () => {
            setCkBusy(true);
            setCkMsg(null);
            try {
              const r = await window.api.cookieLogin({
                ipbMemberId: ckMember,
                ipbPassHash: ckHash,
                igneous: ckIgneous || null,
                verify: ckVerify,
              });
              setCkMsg(r.message);
              if (r.ok) setExAcc(await window.api.getExAccounts());
            } catch (e: any) {
              setCkMsg(`Ошибка: ${e?.message ?? e}`);
            } finally {
              setCkBusy(false);
            }
          }}
        >
          🍪 Войти по куки
        </button>
        <button
          disabled={ignBusy}
          title="Получить igneous из Set-Cookie exhentai.org"
          onClick={async () => {
            setIgnBusy(true);
            setIgnMsg(null);
            try {
              const r = await window.api.refreshIgneous();
              setIgnMsg(r.message);
              if (r.ok) setExAcc(await window.api.getExAccounts());
            } catch (e: any) {
              setIgnMsg(`Ошибка: ${e?.message ?? e}`);
            } finally {
              setIgnBusy(false);
            }
          }}
        >
          🔄 Получить igneous (доступ к EX)
        </button>
      </div>
      {(ckMsg || ignMsg) && <div className="row muted">{ckMsg ?? ignMsg}</div>}
      <div className="row">
        <label>Вход по логину/паролю (E-Hentai):</label>
      </div>
      <div className="row">
        <input
          className="text-input"
          placeholder="Логин"
          value={pwUser}
          onChange={(e) => setPwUser(e.target.value)}
          style={{ width: 160 }}
        />
        <input
          className="text-input"
          type="password"
          placeholder="Пароль"
          value={pwPass}
          onChange={(e) => setPwPass(e.target.value)}
          style={{ width: 160 }}
        />
        <button
          disabled={pwBusy}
          onClick={async () => {
            setPwBusy(true);
            setPwMsg(null);
            try {
              const r = await window.api.loginPassword(pwUser, pwPass);
              setPwMsg(r.message);
              if (r.ok) {
                setPwPass('');
                setExAcc(await window.api.getExAccounts());
              }
            } catch (e: any) {
              setPwMsg(`Ошибка: ${e?.message ?? e}`);
            } finally {
              setPwBusy(false);
            }
          }}
        >
          🔑 Войти
        </button>
      </div>
      {pwMsg && <div className="row muted">{pwMsg}</div>}
      <div className="row">
        <label>Активный аккаунт используется для всех запросов к ExHentai (обычный режим).</label>
      </div>
      {exAcc.accounts.length === 0 && <div className="row muted">Нет ни одного аккаунта.</div>}
      {exAcc.accounts.map((a) => (
        <div className="row" key={a.id}>
          <button
            className={a.id === exAcc.currentId ? 'tab active' : 'tab'}
            onClick={() => void window.api.setExAccount(a.id).then(setExAcc)}
          >
            {a.name}
          </button>
          <button
            className="icon-btn"
            title="Удалить аккаунт"
            onClick={async () => {
              setExAcc(await window.api.removeExAccount(a.id));
            }}
          >
            ✕
          </button>
        </div>
      ))}
      <div className="row">
        <button
          onClick={() =>
            void (async () => {
              const r = await window.api.importExAccounts();
              if (r) {
                setExAcc(r.accounts);
                setExNotice(r.count > 0 ? `Импортировано аккаунтов: ${r.count}` : 'В файле не найдено аккаунтов');
              }
            })()
          }
        >
          📂 Импортировать пул (Share, storage.json)
        </button>
        <button
          onClick={async () => {
            const r = await window.api.addExAccount(exName, exMemberId, exPassHash, exIgneous);
            setExAcc(r);
            setExNotice(`Добавлен аккаунт (${r.currentId ? r.accounts.find((a) => a.id === r.currentId)?.name : ''})`);
            setExName('');
            setExMemberId('');
            setExPassHash('');
            setExIgneous('');
          }}
        >
          ＋ Добавить аккаунт вручную
        </button>
      </div>
      {exNotice && <div className="row muted">{exNotice}</div>}
      <div className="row">
        <label>Название (необязательно)</label>
        <input className="text-input" value={exName} onChange={(e) => setExName(e.target.value)} />
      </div>
      <div className="row">
        <label>ipb_member_id</label>
        <input className="text-input" value={exMemberId} onChange={(e) => setExMemberId(e.target.value)} />
      </div>
      <div className="row">
        <label>ipb_pass_hash</label>
        <input className="text-input" value={exPassHash} onChange={(e) => setExPassHash(e.target.value)} />
      </div>
      <div className="row">
        <label>igneous (только для ExHentai)</label>
        <input className="text-input" value={exIgneous} onChange={(e) => setExIgneous(e.target.value)} />
      </div>
    </Section>
  );
}
