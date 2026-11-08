import { useEffect, useState } from 'react';
import Section, { Row, SubHead } from './Section';
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
    <Section title="Аккаунты ExHentai" desc="Активный аккаунт используется для всех запросов к ExHentai в обычном режиме.">
      <SubHead>Вход по куки</SubHead>
      <Row stack>
        <textarea
          className="cookie-input"
          rows={2}
          value={ckText}
          placeholder="Вставь куки (например, из буфера обмена) и нажми «Распознать»"
          onChange={(e) => setCkText(e.target.value)}
        />
      </Row>
      <Row>
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
          Из буфера
        </button>
        <Toggle className="filter-check" checked={ckVerify} onChange={setCkVerify}>
          Проверять вход
        </Toggle>
      </Row>
      <Row label="ipb_member_id">
        <input className="text-input" value={ckMember} onChange={(e) => setCkMember(e.target.value)} />
      </Row>
      <Row label="ipb_pass_hash">
        <input className="text-input" value={ckHash} onChange={(e) => setCkHash(e.target.value)} />
      </Row>
      <Row label="igneous" note="Необязательно, только для ExHentai.">
        <input className="text-input" value={ckIgneous} onChange={(e) => setCkIgneous(e.target.value)} />
      </Row>
      <Row label="Вход">
        <button
          className="set-primary"
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
          Войти по куки
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
          Получить igneous
        </button>
      </Row>
      {(ckMsg || ignMsg) && (
        <Row stack>
          <span className="set-note">{ckMsg ?? ignMsg}</span>
        </Row>
      )}

      <SubHead>Логин и пароль</SubHead>
      <Row label="E-Hentai">
        <input
          className="text-input short"
          placeholder="Логин"
          value={pwUser}
          onChange={(e) => setPwUser(e.target.value)}
        />
        <input
          className="text-input short"
          type="password"
          placeholder="Пароль"
          value={pwPass}
          onChange={(e) => setPwPass(e.target.value)}
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
          Войти
        </button>
      </Row>
      {pwMsg && (
        <Row stack>
          <span className="set-note">{pwMsg}</span>
        </Row>
      )}

      <SubHead>Сохранённые аккаунты</SubHead>
      {exAcc.accounts.length === 0 ? (
        <Row stack>
          <span className="set-note">Нет ни одного аккаунта.</span>
        </Row>
      ) : (
        <Row stack>
          <div className="acct-list">
            {exAcc.accounts.map((a) => (
              <div className="acct-chip" key={a.id}>
                <button
                  className={`acct-name${a.id === exAcc.currentId ? ' active' : ''}`}
                  onClick={() => void window.api.setExAccount(a.id).then(setExAcc)}
                  title={a.id === exAcc.currentId ? 'Активный аккаунт' : 'Сделать активным'}
                >
                  {a.name}
                </button>
                <button
                  className="acct-del"
                  title="Удалить аккаунт"
                  aria-label="Удалить аккаунт"
                  onClick={async () => {
                    setExAcc(await window.api.removeExAccount(a.id));
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </Row>
      )}
      <Row label="Пул аккаунтов">
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
          Импортировать (Share, storage.json)
        </button>
      </Row>

      <SubHead>Новый аккаунт</SubHead>
      <Row label="Название" note="Необязательно.">
        <input className="text-input" value={exName} onChange={(e) => setExName(e.target.value)} />
      </Row>
      <Row label="ipb_member_id">
        <input className="text-input" value={exMemberId} onChange={(e) => setExMemberId(e.target.value)} />
      </Row>
      <Row label="ipb_pass_hash">
        <input className="text-input" value={exPassHash} onChange={(e) => setExPassHash(e.target.value)} />
      </Row>
      <Row label="igneous" note="Только для ExHentai.">
        <input className="text-input" value={exIgneous} onChange={(e) => setExIgneous(e.target.value)} />
      </Row>
      <Row>
        <button
          className="set-primary"
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
          Добавить аккаунт
        </button>
      </Row>
      {exNotice && (
        <Row stack>
          <span className="set-note">{exNotice}</span>
        </Row>
      )}
    </Section>
  );
}
