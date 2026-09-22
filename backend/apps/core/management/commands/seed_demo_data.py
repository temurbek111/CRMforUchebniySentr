"""Seed a realistic, fully coherent demo learning centre.

Everything is created through the application's own services, so the seeded
database exercises the same rules as production traffic: invoices, partial
payments, submitted attendance, exams with components, payroll runs and a CRM
pipeline that actually converts.

Usage:
    manage.py seed_demo_data            # add data, skipping what already exists
    manage.py seed_demo_data --reset    # wipe centre data first (keeps nothing)
"""

from __future__ import annotations

import random
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import Role, User
from apps.academics.models import Course, Group, GroupMembership, Room, Student, Teacher
from apps.academics.services import create_student, enroll_student
from apps.attendance.services import get_or_create_session, mark_attendance
from apps.core.models import AuditLog, Notification, SystemSettings
from apps.crm.models import Lead
from apps.exams.models import Exam, ExamComponent, ExamResult
from apps.finance.models import Expense, Income, Payment, StudentInvoice
from apps.finance.services import (
    create_expense,
    create_income,
    ensure_invoice,
    get_or_create_billing_period,
    record_payment,
)
from apps.payroll.models import PayrollItem, PayrollRun, SalaryPolicy
from apps.payroll.services import (
    approve_payroll_run,
    calculate_payroll_run,
    mark_payroll_paid,
    set_salary_policy,
)
from apps.reporting.services import sync_notifications
from apps.schedule.services import create_slot

RNG = random.Random(20260920)

FIRST_NAMES_M = [
    "Ali", "Bekzod", "Sardor", "Aziz", "Jasur", "Timur", "Rustam", "Ulugbek", "Sherzod",
    "Kamron", "Doniyor", "Islom", "Muhammad", "Shohruh", "Akmal", "Davron", "Farrux",
    "Otabek", "Sanjar", "Javohir", "Bobur", "Anvar", "Ilhom", "Nodir",
]
FIRST_NAMES_F = [
    "Madina", "Zarina", "Nilufar", "Dilnoza", "Malika", "Laylo", "Gulnora", "Sevara",
    "Shahnoza", "Aziza", "Oysha", "Kamola", "Dildora", "Nargiza", "Sabina", "Umida",
    "Zulfiya", "Maftuna", "Diana", "Alina", "Yulduz", "Nodira",
]
LAST_NAMES = [
    "Karimov", "Tursunov", "Yusupov", "Aliyev", "Rakhimov", "Ismoilov", "Abdullayev",
    "Nazarov", "Ergashev", "Saidov", "Umarov", "Xolmatov", "Rasulov", "Qodirov",
    "Sobirov", "Mirzayev", "Toshmatov", "Bekmurodov", "Iskandarov", "Pulatov",
]
GUARDIAN_FIRST = ["Bahodir", "Nodira", "Gulbahor", "Ravshan", "Dilbar", "Anvar", "Zebo", "Kamol"]

COURSES = [
    ("ENG", "General English", "1200000", "A2", 9),
    ("IELTS", "IELTS Preparation", "1900000", "B2", 4),
    ("MATH", "Mathematics", "1000000", "B1", 9),
    ("PROG", "Python Programming", "1500000", "A1", 6),
    ("SAT", "SAT Preparation", "2000000", "B2", 4),
]

ROOMS = [
    ("Room 101", 15), ("Room 102", 12), ("Room 105", 16), ("Room 201", 18),
    ("Room 202", 20), ("Room 203", 10), ("Room 204", 16), ("Room 301", 25),
    ("Room 302", 14), ("Lab 1", 12), ("Hall A", 40), ("Room 303", 8),
]

# (first, last, specialization, employment, salary model, params)
TEACHERS = [
    ("John", "Karimov", "IELTS", "full_time", "fixed", {"base_amount": Decimal("7000000")}),
    ("Dilnoza", "Yusupova", "General English", "full_time", "hybrid",
     {"base_amount": Decimal("3000000"), "lesson_bonus": Decimal("60000")}),
    ("Sardor", "Aliyev", "Mathematics", "part_time", "per_class",
     {"per_lesson_rate": Decimal("80000")}),
    ("Malika", "Rakhimova", "General English", "full_time", "hybrid",
     {"base_amount": Decimal("2800000"), "lesson_bonus": Decimal("65000")}),
    ("Aziz", "Tursunov", "Python Programming", "full_time", "fixed",
     {"base_amount": Decimal("6000000")}),
    ("Nilufar", "Saidova", "SAT", "contract", "percentage",
     {"revenue_share_pct": Decimal("30")}),
    ("Ravshan", "Ismoilov", "IELTS", "part_time", "per_class",
     {"per_lesson_rate": Decimal("90000")}),
    ("Zarina", "Abdullayeva", "General English", "full_time", "fixed",
     {"base_amount": Decimal("4500000")}),
    ("Timur", "Nazarov", "Mathematics", "contract", "percentage",
     {"revenue_share_pct": Decimal("25")}),
    ("Laylo", "Ergasheva", "Python Programming", "part_time", "per_class",
     {"per_lesson_rate": Decimal("75000")}),
]

# (name, course_code, teacher_index, room, weekdays, start, end, fee, capacity)
GROUPS = [
    ("IELTS Evening A", "IELTS", 0, "Room 204", [0, 2, 4], time(18, 0), time(19, 30), "1900000", 14),
    ("IELTS Morning B", "IELTS", 6, "Room 201", [1, 3, 5], time(9, 0), time(10, 30), "1900000", 12),
    ("General English A2", "ENG", 1, "Room 101", [0, 2, 4], time(16, 0), time(17, 30), "1200000", 15),
    ("General English B1", "ENG", 3, "Room 102", [1, 3], time(17, 0), time(18, 30), "1350000", 12),
    ("Math Foundations", "MATH", 2, "Room 202", [0, 2], time(15, 0), time(16, 30), "1000000", 18),
    ("Math Advanced", "MATH", 8, "Room 203", [1, 3], time(15, 0), time(16, 30), "1200000", 10),
    ("Python Basics", "PROG", 4, "Lab 1", [0, 2, 4], time(19, 0), time(20, 30), "1500000", 12),
    ("SAT Intensive", "SAT", 5, "Room 301", [1, 3, 5], time(14, 0), time(15, 30), "2000000", 20),
    ("Python Evening", "PROG", 9, "Room 302", [1, 3], time(19, 30), time(21, 0), "1500000", 10),
    ("English Teens", "ENG", 7, "Room 105", [0, 5], time(14, 0), time(15, 30), "1100000", 16),
]

LEAD_SOURCES = ["Instagram", "Telegram", "Referral", "Website", "Walk-in", "Advertisement", "Other"]


class Command(BaseCommand):
    help = "Populate the database with a realistic demo learning centre."

    def add_arguments(self, parser):
        parser.add_argument("--reset", action="store_true",
                            help="Delete existing centre data before seeding.")
        parser.add_argument("--students", type=int, default=92,
                            help="Approximate number of students to create.")

    @transaction.atomic
    def handle(self, *args, **options):
        today = timezone.localdate()
        if options["reset"]:
            self._wipe()

        if Group.objects.exists() and not options["reset"]:
            self.stdout.write(self.style.WARNING(
                "Centre data already present. Use --reset to rebuild from scratch."
            ))
            return

        settings_obj = self._settings()
        users = self._users()
        courses = self._courses()
        rooms = self._rooms()
        teachers = self._teachers(users)
        groups = self._groups(courses, rooms, teachers, today)
        students = self._students(options["students"], groups, users, today)
        self._billing(students, groups, users, today)
        self._attendance(groups, teachers, today)
        self._exams(groups, teachers, users, today)
        self._expenses_income(users, today)
        self._payroll(teachers, users, today)
        self._crm(courses, groups, users, today)
        sync_notifications()
        self._summary(settings_obj)

    # ------------------------------------------------------------------ #
    # Reset
    # ------------------------------------------------------------------ #
    def _wipe(self) -> None:
        from apps.academics.models import StudentNote
        from apps.attendance.models import AttendanceRecord, AttendanceSession
        from apps.schedule.models import ScheduleSlot

        self.stdout.write("Resetting centre data…")
        for model in (
            ExamResult, ExamComponent, Exam, PayrollItem, PayrollRun, SalaryPolicy,
            Payment, StudentInvoice, Expense, Income, Notification, AuditLog,
            AttendanceRecord, AttendanceSession, StudentNote, Lead,
            GroupMembership, ScheduleSlot, Group, Student, Course, Room, Teacher,
        ):
            model.objects.all().delete()

    # ------------------------------------------------------------------ #
    # Building blocks
    # ------------------------------------------------------------------ #
    def _settings(self) -> SystemSettings:
        settings_obj = SystemSettings.get_solo()
        settings_obj.centre_name = "Nexus Learning Centre"
        settings_obj.currency_code = "UZS"
        settings_obj.currency_symbol = "so'm"
        settings_obj.currency_decimals = 0
        settings_obj.default_billing_day = 5
        settings_obj.academic_year_start = date(timezone.localdate().year, 9, 1)
        settings_obj.academic_year_end = date(timezone.localdate().year + 1, 6, 30)
        settings_obj.save()
        return settings_obj

    def _users(self) -> dict[str, User]:
        password = "Demo12345!"
        specs = [
            ("admin", "Aziz", "Rahmonov", "super_admin", True),
            ("manager", "Kamila", "Yusupova", "manager", False),
            ("accountant", "Nigora", "Salimova", "accountant", False),
            ("reception", "Dilshod", "Umarov", "receptionist", False),
            ("teacher.john", "John", "Karimov", "teacher", False),
            ("teacher.dilnoza", "Dilnoza", "Yusupova", "teacher", False),
        ]
        accounts: dict[str, User] = {}
        for username, first, last, role_code, is_super in specs:
            user, created = User.objects.get_or_create(
                username=username,
                defaults={
                    "first_name": first, "last_name": last,
                    "email": f"{username}@nexus-learning.uz",
                    "role": Role.objects.filter(code=role_code).first(),
                    "is_superuser": is_super, "is_staff": is_super,
                },
            )
            if created:
                user.set_password(password)
                user.save()
            accounts[username] = user
        return accounts

    def _courses(self) -> dict[str, Course]:
        courses: dict[str, Course] = {}
        for code, name, fee, level, duration in COURSES:
            course, _ = Course.objects.get_or_create(
                code=code,
                defaults={
                    "name": name, "level": level,
                    "default_monthly_fee": Decimal(fee),
                    "duration_months": duration,
                    "description": f"{name} programme at Nexus Learning Centre.",
                },
            )
            courses[code] = course
        return courses

    def _rooms(self) -> dict[str, Room]:
        rooms: dict[str, Room] = {}
        for name, capacity in ROOMS:
            room, _ = Room.objects.get_or_create(
                name=name,
                defaults={"capacity": capacity, "location": name.split()[0] if name else "",
                          "equipment": "Projector, whiteboard" if name != "Lab 1" else "Workstations"},
            )
            rooms[name] = room
        return rooms

    def _teachers(self, users: dict[str, User]) -> list[Teacher]:
        teachers: list[Teacher] = []
        for index, (first, last, spec, employment, _model, _params) in enumerate(TEACHERS):
            user = None
            if index == 0:
                user = users["teacher.john"]
            elif index == 1:
                user = users["teacher.dilnoza"]
            teacher, created = Teacher.objects.get_or_create(
                first_name=first, last_name=last,
                defaults={
                    "phone": self._phone(),
                    "email": f"{first.lower()}.{last.lower()}@nexus-learning.uz",
                    "specialization": spec,
                    "employment_type": employment,
                    "start_date": date.today() - timedelta(days=RNG.randint(120, 900)),
                    "status": "active",
                    "user": user,
                },
            )
            if user and teacher.user_id is None:
                teacher.user = user
                teacher.save(update_fields=["user"])
            teachers.append(teacher)
        return teachers

    def _groups(self, courses, rooms, teachers, today) -> list[Group]:
        groups: list[Group] = []
        for (name, course_code, teacher_index, room_name, weekdays, start, end,
             fee, capacity) in GROUPS:
            teacher = teachers[teacher_index]
            group, created = Group.objects.get_or_create(
                name=name,
                defaults={
                    "course": courses[course_code],
                    "teacher": teacher,
                    "room": rooms[room_name],
                    "capacity": capacity,
                    "level": courses[course_code].level,
                    "monthly_fee": Decimal(fee),
                    "start_date": today - timedelta(days=150),
                    "status": "active",
                },
            )
            if created:
                for weekday in weekdays:
                    create_slot(
                        group=group, weekday=weekday, start_time=start, end_time=end,
                        teacher=teacher, room=rooms[room_name],
                        effective_from=group.start_date,
                    )
            groups.append(group)
        return groups

    def _students(self, count: int, groups, users, today) -> list[Student]:
        """Create students, enrol them, and leave a realistic lifecycle behind."""
        receptionist = users["reception"]
        students: list[Student] = []
        for index in range(count):
            gender = "male" if RNG.random() < 0.48 else "female"
            first = RNG.choice(FIRST_NAMES_M if gender == "male" else FIRST_NAMES_F)
            last = RNG.choice(LAST_NAMES)
            age = RNG.randint(11, 34)
            dob = today - timedelta(days=age * 365 + RNG.randint(0, 360))
            registered = today - timedelta(days=RNG.randint(3, 170))
            minor = age < 18
            student = create_student(
                actor=receptionist,
                first_name=first, last_name=last,
                gender=gender, date_of_birth=dob,
                phone=self._phone(), address=self._address(),
                email=f"{first.lower()}.{last.lower()}{index}@example.uz",
                registered_at=registered,
                status="active",
                guardian_name=f"{RNG.choice(GUARDIAN_FIRST)} {last}" if minor else "",
                guardian_phone=self._phone() if minor else "",
                guardian_relation=RNG.choice(["mother", "father", "guardian"]) if minor else "guardian",
            )
            # one or two groups, never breaching capacity
            open_groups = [g for g in groups if g.student_count < g.capacity and g.start_date <= registered]
            if not open_groups:
                open_groups = [g for g in groups if g.student_count < g.capacity]
            if not open_groups:
                break
            picks = RNG.sample(open_groups, 1) if RNG.random() < 0.82 else RNG.sample(
                open_groups, min(2, len(open_groups))
            )
            for group in picks:
                enroll_student(student=student, group=group, actor=receptionist,
                               joined_at=registered, note="Initial enrolment")
            students.append(student)

        # A handful of students leave the centre across the period.
        for student in RNG.sample(students, max(int(len(students) * 0.06), 1)):
            left = today - timedelta(days=RNG.randint(5, 60))
            student.status = RNG.choice(["dropped", "graduated", "paused"])
            student.left_at = left
            student.leave_reason = RNG.choice(
                ["Moved city", "Course completed", "Financial reasons", "Took a break"]
            )
            student.save(update_fields=["status", "left_at", "leave_reason"])
        return students

    def _billing(self, students, groups, users, today) -> None:
        """Five months of invoices and payments: full, partial, late and unpaid."""
        accountant = users["accountant"]
        for months_back in range(4, -1, -1):
            month_anchor = today.replace(day=1) - timedelta(days=months_back * 30)
            period_start = month_anchor.replace(day=1)
            if period_start > today:
                continue
            period = get_or_create_billing_period(period_start)
            for student in students:
                member = (
                    GroupMembership.objects.filter(student=student, left_at__isnull=True)
                    .select_related("group").first()
                    or GroupMembership.objects.filter(student=student)
                    .select_related("group").order_by("-joined_at").first()
                )
                if member is None:
                    continue
                if member.joined_at > period.period_end:
                    continue  # not a student yet in this period
                if student.left_at and student.left_at < period.period_start:
                    continue
                fee = member.effective_fee
                if fee <= 0:
                    continue
                invoice = ensure_invoice(
                    student, period_start, amount_due=fee, due_date=period.due_date,
                    group=member.group, actor=accountant,
                )
                if invoice.amount_paid > 0:
                    continue

                roll = RNG.random()
                if months_back == 0:
                    # the current period is still being collected
                    if roll < 0.55:
                        record_payment(student=student, amount=fee, invoice=invoice,
                                       paid_at=today - timedelta(days=RNG.randint(0, 4)),
                                       method=self._method(), actor=accountant,
                                       reference=f"CASH-{student.code}")
                    elif roll < 0.72:
                        record_payment(student=student, amount=(fee / 2).quantize(Decimal("1")),
                                       invoice=invoice, paid_at=today - timedelta(days=RNG.randint(0, 6)),
                                       method=self._method(), actor=accountant,
                                       reference=f"PART-{student.code}")
                else:
                    if roll < 0.82:
                        record_payment(student=student, amount=fee, invoice=invoice,
                                       paid_at=period.period_start + timedelta(days=RNG.randint(1, 12)),
                                       method=self._method(), actor=accountant,
                                       reference=f"INV-{period.period_start:%Y%m}-{student.code}")
                    elif roll < 0.94:
                        half = (fee / 2).quantize(Decimal("1"))
                        record_payment(student=student, amount=half, invoice=invoice,
                                       paid_at=period.period_start + timedelta(days=RNG.randint(2, 10)),
                                       method=self._method(), actor=accountant,
                                       reference=f"PART-{period.period_start:%Y%m}-{student.code}")
                    # the rest stay unpaid and become overdue as time passes

    def _attendance(self, groups, teachers, today) -> None:
        """Six weeks of submitted attendance with believable absence patterns."""
        weak_students = set(
            Student.objects.filter(status="active").values_list("pk", flat=True)[:6]
        )
        for group in groups:
            weekdays = set(group.slots.values_list("weekday", flat=True))
            if not weekdays:
                continue
            for offset in range(41, -1, -1):
                day = today - timedelta(days=offset)
                if day.weekday() not in weekdays or day < group.start_date:
                    continue
                session = get_or_create_session(group, day, teacher=group.teacher)
                roster = list(
                    Student.objects.filter(
                        group_memberships__group=group, group_memberships__left_at__isnull=True
                    ).distinct().values_list("pk", flat=True)
                )
                if not roster:
                    continue
                entries = []
                for student_id in roster:
                    roll = RNG.random()
                    if student_id in weak_students:
                        roll = RNG.random() * 0.7
                    if roll < 0.86:
                        entries.append({"student": student_id, "status": "present"})
                    elif roll < 0.92:
                        entries.append({"student": student_id, "status": "absent",
                                        "reason": RNG.choice(["sick", "personal", "unknown"])})
                    elif roll < 0.96:
                        entries.append({"student": student_id, "status": "late"})
                    else:
                        entries.append({"student": student_id, "status": "excused",
                                        "reason": "sick"})
                mark_attendance(session, entries, actor=group.teacher.user if group.teacher else None,
                                submit=True)

    def _exams(self, groups, teachers, users, today) -> None:
        """A monthly test plus an IELTS-style mock for every group."""
        from apps.exams.services import create_exam, record_results

        teacher_user = users["teacher.john"]
        for group in groups:
            members = list(
                Student.objects.filter(
                    group_memberships__group=group, group_memberships__left_at__isnull=True
                ).distinct()
            )
            if not members:
                continue

            monthly, _ = Exam.objects.get_or_create(
                group=group, name=f"{group.name} — Monthly Test",
                defaults={
                    "course": group.course, "teacher": group.teacher,
                    "exam_type": "monthly_test",
                    "date": today.replace(day=1) - timedelta(days=12),
                    "max_score": Decimal("100"), "passing_score": Decimal("60"),
                    "description": "Monthly progress test", "is_published": True,
                },
            )
            if not monthly.results.exists():
                record_results(monthly, [
                    {"student": student.pk, "component": None,
                     "score": Decimal(str(self._score(student, 58, 96))),
                     "teacher_comment": RNG.choice(["Good progress", "Keep practising", "Well done", ""])}
                    for student in members
                ], actor=teacher_user)

            mock = Exam.objects.filter(group=group, exam_type="mock_exam").first()
            if mock is None:
                mock = create_exam(
                    group=group, name=f"{group.name} — Mock Exam",
                    exam_type="mock_exam",
                    exam_date=today - timedelta(days=5),
                    course=group.course, teacher=group.teacher,
                    max_score=Decimal("9"), passing_score=Decimal("5.5"),
                    description="Four-skill mock examination",
                    components=[
                        {"name": "Listening", "max_score": Decimal("9"), "order": 1},
                        {"name": "Reading", "max_score": Decimal("9"), "order": 2},
                        {"name": "Writing", "max_score": Decimal("9"), "order": 3},
                        {"name": "Speaking", "max_score": Decimal("9"), "order": 4},
                    ],
                    actor=teacher_user,
                )
            if mock.results.exists():
                continue
            components = list(mock.components.order_by("order"))
            entries = []
            for student in members:
                base = self._score(student, 45, 88)
                for component in components:
                    spread = RNG.choice([-6, -3, 0, 0, 3, 6])
                    score = max(30, min(97, base + spread))
                    entries.append({
                        "student": student.pk, "component": component.pk,
                        "score": Decimal(str(round(component.max_score * Decimal(score) / Decimal(100), 1))),
                        "teacher_comment": "",
                    })
            record_results(mock, entries, actor=teacher_user)

    def _expenses_income(self, users, today) -> None:
        accountant = users["accountant"]
        monthly = [
            ("rent", Decimal("6000000"), "Monthly rent for the centre"),
            ("utilities", Decimal("850000"), "Electricity, water and heating"),
            ("internet", Decimal("420000"), "Fibre internet and Wi-Fi"),
            ("marketing", Decimal("1200000"), "Instagram and Telegram campaigns"),
            ("office_supplies", Decimal("310000"), "Printing and stationery"),
        ]
        for months_back in range(4, -1, -1):
            anchor = (today.replace(day=1) - timedelta(days=months_back * 30)).replace(day=1)
            if anchor > today:
                continue
            for category, amount, description in monthly:
                Expense.objects.get_or_create(
                    category=category, date=anchor + timedelta(days=3), amount=amount,
                    defaults={"description": description, "method": "bank_transfer",
                              "created_by": accountant},
                )

        Income.objects.get_or_create(
            category="registration_fees", date=today - timedelta(days=20),
            amount=Decimal("1800000"),
            defaults={"description": "Registration fees collected", "method": "cash",
                      "created_by": accountant},
        )
        Income.objects.get_or_create(
            category="exam_fees", date=today - timedelta(days=8), amount=Decimal("2400000"),
            defaults={"description": "Mock exam entry fees", "method": "card",
                      "created_by": accountant},
        )

    def _payroll(self, teachers, users, today) -> None:
        manager = users["manager"]
        accountant = users["accountant"]
        effective_from = today - timedelta(days=140)
        for teacher, (_f, _l, _s, _e, model, params) in zip(teachers, TEACHERS):
            if SalaryPolicy.objects.filter(teacher=teacher).exists():
                continue
            set_salary_policy(teacher=teacher, model=model, effective_from=effective_from,
                              actor=accountant, **params)

        previous_start = (today.replace(day=1) - timedelta(days=1)).replace(day=1)
        previous_end = today.replace(day=1) - timedelta(days=1)
        if not PayrollRun.objects.filter(period_start=previous_start).exists():
            run = calculate_payroll_run(period_start=previous_start, period_end=previous_end,
                                        actor=accountant)
            approve_payroll_run(run, actor=manager)
            mark_payroll_paid(run, actor=accountant, method="bank_transfer")

        current_start = today.replace(day=1)
        if not PayrollRun.objects.filter(period_start=current_start).exists():
            calculate_payroll_run(period_start=current_start, period_end=today, actor=accountant)

    def _crm(self, courses, groups, users, today) -> None:
        """A live pipeline: new leads, trials, losses and real conversions."""
        from apps.crm.services import (
            change_lead_status,
            convert_lead_to_student,
            create_lead,
            log_activity,
            record_trial_completed,
            schedule_trial,
        )

        receptionist = users["reception"]
        if Lead.objects.exists():
            return

        targets = [
            ("new", 12), ("contacted", 8), ("trial_scheduled", 5), ("trial_completed", 4),
            ("interested", 4), ("registered", 8), ("lost", 6),
        ]
        created: list[tuple[Lead, str]] = []
        for status, count in targets:
            for _ in range(count):
                gender = "male" if RNG.random() < 0.5 else "female"
                first = RNG.choice(FIRST_NAMES_M if gender == "male" else FIRST_NAMES_F)
                last = RNG.choice(LAST_NAMES)
                course_code = RNG.choice(list(courses))
                course = courses[course_code]
                lead = create_lead(
                    full_name=f"{first} {last}",
                    phone=self._phone(),
                    email=f"{first.lower()}.{last.lower()}@example.uz" if RNG.random() < 0.6 else "",
                    source=RNG.choice(LEAD_SOURCES),
                    interested_course=course,
                    assigned_to=receptionist,
                    notes=f"Interested in {course.name}",
                    actor=receptionist,
                )
                created_at = timezone.make_aware(
                    datetime.combine(today - timedelta(days=RNG.randint(1, 75)), time.min)
                )
                Lead.objects.filter(pk=lead.pk).update(created_at=created_at)
                created.append((lead, status))

        for lead, status in created:
            if status == "new":
                continue
            log_activity(lead, "call", "Called to confirm interest", actor=receptionist)
            if status in {"trial_scheduled", "trial_completed", "interested", "registered"}:
                trial_day = today + timedelta(days=RNG.randint(1, 6)) if status == "trial_scheduled" \
                    else today - timedelta(days=RNG.randint(2, 25))
                schedule_trial(lead, trial_day, actor=receptionist)
            if status in {"trial_completed", "interested", "registered"}:
                record_trial_completed(lead, attended=True,
                                       note="Attended the trial lesson", actor=receptionist)
            if status == "interested":
                change_lead_status(lead, "interested", actor=receptionist,
                                   note="Deciding between two courses")
            if status == "lost":
                change_lead_status(lead, "lost", actor=receptionist,
                                   note="Chose another centre")
                lead.lost_reason = RNG.choice(["Price", "Location", "Schedule clash", "Chose competitor"])
                lead.save(update_fields=["lost_reason"])
            if status == "registered":
                change_lead_status(lead, "interested", actor=receptionist,
                                   note="Ready to register")
                open_groups = [g for g in groups if g.student_count < g.capacity]
                group = RNG.choice(open_groups) if open_groups else None
                # convert_lead_to_student also enrols the student into the group,
                # so no second enrolment call is made here.
                convert_lead_to_student(
                    lead, group=group, course=group.course if group else lead.interested_course,
                    start_date=today - timedelta(days=RNG.randint(1, 30)),
                    actor=receptionist, payment_terms="Monthly, due on the 5th",
                )

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #
    def _phone(self) -> str:
        return f"+9989{RNG.randint(10, 99)}{RNG.randint(1000000, 9999999)}"

    def _address(self) -> str:
        return f"{RNG.randint(1, 120)} {RNG.choice(['Amir Temur', 'Chilonzor', 'Yunusobod', 'Mirzo Ulugbek'])} street, Tashkent"

    def _method(self) -> str:
        return RNG.choices(["cash", "bank_transfer", "card", "online"], weights=[6, 2, 1, 1])[0]

    def _score(self, student, low: int, high: int) -> int:
        """Deterministic per-student scores so improvements look real, not noise."""
        base = low + (hash((student.pk, low)) % (high - low))
        return int(base)

    def _summary(self, settings_obj) -> None:
        counts = {
            "courses": Course.objects.count(),
            "rooms": Room.objects.count(),
            "teachers": Teacher.objects.count(),
            "groups": Group.objects.count(),
            "students": Student.objects.count(),
            "active students": Student.objects.filter(status="active").count(),
            "memberships": GroupMembership.objects.count(),
            "invoices": StudentInvoice.objects.count(),
            "payments": Payment.objects.count(),
            "expenses": Expense.objects.count(),
            "payroll runs": PayrollRun.objects.count(),
            "leads": Lead.objects.count(),
            "converted leads": Lead.objects.filter(converted_student__isnull=False).count(),
            "audit entries": AuditLog.objects.count(),
            "notifications": Notification.objects.count(),
        }
        self.stdout.write(self.style.SUCCESS(
            f"\nSeeded {settings_obj.centre_name}:\n"
        ))
        for label, value in counts.items():
            self.stdout.write(f"  {label:<20} {value}")
        self.stdout.write("\nDemo logins (password Demo12345!): "
                          "admin, manager, accountant, reception, teacher.john\n")
