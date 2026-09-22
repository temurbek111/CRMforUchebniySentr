/**
 * Verification harness for the Ventriloc frontend.
 *
 * Lives outside the project on purpose: it drives a real browser against the
 * dev server, and must not become a dependency of the application itself.
 *
 * Checks: console errors, page errors, failed requests, horizontal overflow at
 * three viewports, accessible names on controls, and the interactive states
 * (search modal, create modal, filters, tabs).
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = process.env.BASE_URL ?? 'http://localhost:5173'
const OUT = process.env.OUT_DIR ?? '/tmp/uiverify/shots'
const EXPECTED_TITLE = process.env.EXPECTED_TITLE ?? 'Learning Centre CRM'
mkdirSync(OUT, { recursive: true })

// This app requires a session, so every context logs in before probing routes.
const CREDS = {
  username: process.env.CRM_USER ?? 'manager',
  password: process.env.CRM_PASS ?? 'Demo12345!',
}

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'mobile', width: 390, height: 844 },
]

// Every path the server navigation can emit (see backend apps/accounts/rbac.py).
const STATIC_ROUTES = [
  { path: '/', name: 'dashboard' },
  { path: '/leads', name: 'crm-leads' },
  { path: '/trials', name: 'crm-trials' },
  { path: '/admissions', name: 'crm-admissions' },
  { path: '/students', name: 'students' },
  { path: '/groups', name: 'groups' },
  { path: '/attendance', name: 'attendance' },
  { path: '/exams', name: 'exams' },
  { path: '/results', name: 'results' },
  { path: '/progress', name: 'progress' },
  { path: '/timetable', name: 'timetable' },
  { path: '/calendar', name: 'calendar' },
  { path: '/rooms', name: 'rooms' },
  { path: '/payments', name: 'payments' },
  { path: '/income', name: 'income' },
  { path: '/expenses', name: 'expenses' },
  { path: '/payroll', name: 'payroll' },
  { path: '/teachers', name: 'teachers' },
  { path: '/salaries', name: 'salaries' },
  { path: '/reports', name: 'reports' },
  { path: '/settings/users', name: 'settings-users' },
  { path: '/settings/roles', name: 'settings-roles' },
  { path: '/settings/courses', name: 'settings-courses' },
  { path: '/settings/rooms', name: 'settings-rooms' },
  { path: '/settings/system', name: 'settings-system' },
  { path: '/audit', name: 'audit-log' },
  { path: '/does-not-exist', name: 'not-found' },
]

/** Log in once per browser context; the session cookie then covers every route. */
async function login(context) {
  const csrfResponse = await context.request.get(`${BASE}/api/auth/csrf`)
  const { csrfToken } = await csrfResponse.json()
  const response = await context.request.post(`${BASE}/api/auth/login`, {
    data: CREDS,
    headers: { 'X-CSRFToken': csrfToken },
  })
  if (!response.ok()) {
    throw new Error(`login failed: ${response.status()} ${await response.text()}`)
  }
}

/** Detail routes need real ids; inventing them would test a 404 page. */
async function fetchIds(context) {
  const first = async (path) => {
    const response = await context.request.get(`${BASE}${path}`)
    if (!response.ok()) return null
    const body = await response.json()
    const rows = body.results ?? body
    return Array.isArray(rows) && rows.length > 0 ? rows[0].id : null
  }
  const [student, group, exam, teacher] = await Promise.all([
    first('/api/students/?page_size=1'),
    first('/api/groups/?page_size=1'),
    first('/api/exams/?page_size=1'),
    first('/api/teachers/?page_size=1'),
  ])
  return { student, group, exam, teacher }
}

function buildRoutes(ids) {
  const routes = [...STATIC_ROUTES]
  const detail = [
    ['/students/', '/students/:id', 'student-detail'],
    ['/groups/', '/groups/:id', 'group-detail'],
    ['/exams/', '/exams/:id', 'exam-detail'],
    ['/teachers/', '/teachers/:id', 'teacher-detail'],
  ]
  for (const [prefix, template, name] of detail) {
    const id = ids[name.replace('-detail', '')]
    if (id !== null && id !== undefined) {
      routes.push({ path: `${prefix}${id}`, name })
    } else {
      notes.push(`${name}: skipped, no ${name.replace('-detail', '')} in the database`)
    }
  }
  // ROUTES=/payments,/attendance narrows the sweep for a fast iteration loop.
  const filter = (process.env.ROUTES ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (filter.length === 0) return routes
  return routes.filter((route) => filter.some((f) => route.path === f || route.name === f))
}

const problems = []
const notes = []

const record = (kind, route, viewport, detail) => {
  problems.push({ kind, route, viewport, detail })
}

const browser = await chromium.launch()

for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
  })

  await login(context)
  const ids = await fetchIds(context)
  const ROUTES = buildRoutes(ids)

  for (const route of ROUTES) {
    const page = await context.newPage()

    const consoleErrors = []
    const pageErrors = []
    const failedRequests = []

    page.on('console', (message) => {
      const type = message.type()
      if (type === 'error' || type === 'warning') {
        const text = message.text()
        // React Router warns about future flags; not our concern here.
        if (text.includes('React Router Future Flag')) return
        consoleErrors.push(`${type}: ${text}`)
      }
    })
    page.on('pageerror', (error) => pageErrors.push(String(error)))
    page.on('requestfailed', (request) => {
      const url = request.url()
      if (url.startsWith('data:')) return
      const errorText = request.failure()?.errorText ?? ''
      // React StrictMode (dev builds only) mounts every effect twice, so the
      // first pass's fetches are aborted by their own cleanup. An aborted
      // request was superseded, not failed — a real failure arrives as a 4xx/5xx
      // response and is counted separately below.
      if (errorText.includes('ERR_ABORTED')) return
      failedRequests.push(`${request.method()} ${url} — ${errorText}`)
    })

    await page.goto(`${BASE}${route.path}`, { waitUntil: 'networkidle', timeout: 45000 })
    // Allow the simulated service latency to settle everywhere on the page.
    await page.waitForTimeout(2400)

    // 1. Console and runtime health.
    consoleErrors.forEach((detail) => record('console', route.path, viewport.name, detail))
    pageErrors.forEach((detail) => record('pageerror', route.path, viewport.name, detail))
    failedRequests.forEach((detail) => record('request', route.path, viewport.name, detail))

    // 2. Horizontal overflow — the classic responsive failure. Only elements
    //    with no clipping ancestor count: content inside a scroll container or
    //    an sr-only wrapper is expected to sit outside the viewport.
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement
      const clipped = (node) => {
        let current = node.parentElement
        while (current && current !== document.documentElement) {
          const overflowX = getComputedStyle(current).overflowX
          if (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'hidden') return true
          current = current.parentElement
        }
        return false
      }
      const beyond = [...document.querySelectorAll('body *')]
        .filter(
          (element) =>
            element.getBoundingClientRect().right > window.innerWidth + 2 && !clipped(element),
        )
        .slice(0, 5)
        .map((element) => `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 60)}`)
      return { scrollWidth: doc.scrollWidth, innerWidth: window.innerWidth, beyond }
    })
    if (overflow.scrollWidth > overflow.innerWidth + 2) {
      record(
        'overflow',
        route.path,
        viewport.name,
        `scrollWidth ${overflow.scrollWidth} > viewport ${overflow.innerWidth}; offenders: ${overflow.beyond.join(' | ') || 'none identified'}`,
      )
    }

    // 3. Every control needs an accessible name.
    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll('button, a[href], input, select, textarea')]
        .filter((element) => {
          const label =
            element.getAttribute('aria-label') ||
            element.textContent?.trim() ||
            element.getAttribute('title') ||
            element.closest('label')?.textContent?.trim() ||
            (element.id && document.querySelector(`label[for="${element.id}"]`)?.textContent?.trim())
          return !label
        })
        .slice(0, 6)
        .map((element) => `${element.tagName.toLowerCase()}[${String(element.className).slice(0, 40)}]`),
    )
    unnamed.forEach((detail) => record('a11y-name', route.path, viewport.name, detail))

    // 4. Structure sanity: one h1, a main landmark, a skip link.
    const structure = await page.evaluate(() => ({
      h1: document.querySelectorAll('h1').length,
      main: document.querySelectorAll('main').length,
      skip: Boolean(document.querySelector('a.skipLink')),
      title: document.title,
    }))
    if (structure.h1 !== 1) record('structure', route.path, viewport.name, `expected 1 h1, found ${structure.h1}`)
    if (structure.main !== 1) record('structure', route.path, viewport.name, `expected 1 main, found ${structure.main}`)
    if (!structure.skip) record('structure', route.path, viewport.name, 'no skip link')
    if (!structure.title.includes(EXPECTED_TITLE)) {
      record('structure', route.path, viewport.name, `title was ${JSON.stringify(structure.title)}, expected to include ${JSON.stringify(EXPECTED_TITLE)}`)
    }

    // 5. The route must have rendered real content - not an honest placeholder,
    //    and not nothing at all.
    //
    //    This is the check that catches a screen which looks healthy while
    //    telling the user nothing: a navigation entry whose page module was never
    //    written resolves to ComingSoon, and every other assertion here passes on
    //    it. It also catches a route that threw during render and left an empty
    //    shell behind.
    //
    //    The marker is a class the placeholder component owns
    //    (`coming-soon--unimplemented`), not the shared `.coming-soon` styling
    //    class - NotFoundPage uses that for its 404 layout, and matching it here
    //    would report a false positive on every unknown URL.
    const rendered = await page.evaluate(() => ({
      placeholder: document.querySelectorAll('.coming-soon--unimplemented').length,
      mainText: (document.querySelector('main')?.innerText ?? document.body.innerText).trim().length,
    }))
    if (rendered.placeholder > 0) {
      record(
        'placeholder',
        route.path,
        viewport.name,
        'route resolved to the "Not implemented yet" placeholder — the navigation offers a page that was never written',
      )
    }
    // /does-not-exist is *supposed* to be sparse: it is the 404 page.
    if (route.path !== '/does-not-exist' && rendered.mainText < 100) {
      record(
        'empty-route',
        route.path,
        viewport.name,
        `route rendered almost nothing (${rendered.mainText} characters of text)`,
      )
    }

    await page.screenshot({ path: `${OUT}/${route.name}-${viewport.name}.png`, fullPage: true })
    await page.close()
  }

  await context.close()
}

/* -------------------------------------------------------------------------- */
/* Interactive states — this application's own flows                          */
/* -------------------------------------------------------------------------- */

const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const interactionErrors = []
page.on('pageerror', (error) => interactionErrors.push(String(error)))

// 1. An unauthenticated visit must not leak a protected page.
await page.goto(`${BASE}/payments`, { waitUntil: 'networkidle' })
await page.waitForTimeout(900)
if (!page.url().includes('/login')) {
  record('interaction', '/payments', 'desktop',
    `unauthenticated visit was not redirected to /login (landed on ${page.url()})`)
} else {
  notes.push('unauthenticated /payments redirected to /login')
}
await page.screenshot({ path: `${OUT}/interaction-login.png`, fullPage: false })

// 2. Bad credentials must show an error and must not sign anyone in.
await page.getByLabel('Username').fill(CREDS.username)
await page.getByLabel('Password').fill('definitely-not-the-password')
await page.getByRole('button', { name: 'Sign in' }).click()
await page.waitForTimeout(1500)
if (!page.url().includes('/login')) {
  record('interaction', '/login', 'desktop', 'invalid credentials were accepted')
}
const alertVisible = await page.locator('[role="alert"]').first().isVisible().catch(() => false)
if (!alertVisible) {
  record('interaction', '/login', 'desktop', 'no error message appeared for invalid credentials')
} else {
  notes.push('invalid credentials produced an inline error')
}
await page.screenshot({ path: `${OUT}/interaction-login-error.png`, fullPage: false })

// 3. Real credentials sign in through the form and land inside the shell.
await page.getByLabel('Password').fill(CREDS.password)
await page.getByRole('button', { name: 'Sign in' }).click()
await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15000 })
  .catch(() => {})
if (page.url().includes('/login')) {
  record('interaction', '/login', 'desktop', 'valid credentials did not sign in')
} else {
  notes.push(`form sign-in landed on ${new URL(page.url()).pathname}`)
}
await page.screenshot({ path: `${OUT}/interaction-signed-in.png`, fullPage: false })

// 4. Global search in the topbar must do something real.
await page.goto(`${BASE}/students`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1400)
const searchBox = page.getByLabel('Global search')
if (await searchBox.count() > 0) {
  await searchBox.fill('a')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(2200)
  const dialogOpen = await page.getByRole('dialog').count() > 0
  const navigated = !new URL(page.url()).pathname.endsWith('/students')
  if (!dialogOpen && !navigated) {
    record('interaction', '/students', 'desktop',
      'global search produced nothing visible (no dialog, no navigation)')
  } else {
    notes.push(`global search responded (dialog=${dialogOpen}, navigated=${navigated})`)
  }
} else {
  notes.push('no global search control found in the topbar')
}

// 5. Keyboard focus must reach an interactive control (focus-ring regressions).
await page.keyboard.press('Tab')
await page.keyboard.press('Tab')
const focused = await page.evaluate(() => {
  const el = document.activeElement
  if (el === null) return null
  const label = el.getAttribute('aria-label') ?? (el.textContent ?? '').slice(0, 24)
  return `${el.tagName.toLowerCase()}${label ? `(${label.trim()})` : ''}`
})
notes.push(`two Tabs landed focus on ${focused}`)

interactionErrors.forEach((detail) => record('pageerror', 'interactions', 'desktop', detail))

await browser.close()

/* -------------------------------------------------------------------------- */

const report = {
  baseUrl: BASE,
  problems,
  notes,
  problemCount: problems.length,
}

writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2))

console.log('\n================ VERIFICATION ================')
if (notes.length) {
  console.log('\nObserved:')
  notes.forEach((note) => console.log(`  · ${note}`))
}
if (problems.length === 0) {
  console.log('\nNo console errors, runtime errors, failed requests, overflows, unnamed controls or structural faults.\n')
} else {
  const grouped = problems.reduce((map, problem) => {
    const key = `${problem.kind} @ ${problem.route} (${problem.viewport})`
    map[key] = map[key] ?? []
    map[key].push(problem.detail)
    return map
  }, {})
  console.log(`\n${problems.length} finding(s):`)
  Object.entries(grouped).forEach(([key, details]) => {
    console.log(`\n  ${key}`)
    details.forEach((detail) => console.log(`    - ${detail}`))
  })
  console.log('')
}
console.log('==============================================\n')
process.exit(problems.length === 0 ? 0 : 1)
