import { Course, Certificate, User, PaymentRecord, CreditTransaction, LiveClass, CourseProgress, UserRole } from '../types';

/**
 * Generate mock courses for guest users
 */
export function generateGuestMockCourses(role: 'STUDENT' | 'INSTRUCTOR', userId: string): Course[] {
  const studentCourses: Course[] = [
    {
      id: 'demo_course_1',
      title: 'مقدمة في الذكاء الاصطناعي',
      description: 'تعلم أساسيات الذكاء الاصطناعي والتعلم الآلي',
      instructor: 'د. أحمد محمد',
      level: 'Beginner',
      price: 1500,
      thumbnail: 'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=800',
      modules: [
        {
          id: 'mod_1',
          title: 'الأساسيات',
          items: [
            { id: 'item_1', title: 'مقدمة', type: 'VIDEO', content: '', completed: true },
            { id: 'item_2', title: 'المفاهيم الأساسية', type: 'TEXT', content: '', completed: true }
          ]
        },
        {
          id: 'mod_2',
          title: 'التطبيقات العملية',
          items: [
            { id: 'item_3', title: 'التطبيق الأول', type: 'VIDEO', content: '', completed: false }
          ]
        }
      ],
      category: 'Technology',
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
      id: 'demo_course_2',
      title: 'تطوير تطبيقات الويب',
      description: 'بناء تطبيقات ويب احترافية باستخدام React',
      instructor: 'أ. سارة علي',
      level: 'Intermediate',
      price: 2000,
      thumbnail: 'https://images.unsplash.com/photo-1633356122544-f134324a6cee?w=800',
      modules: [
        {
          id: 'mod_3',
          title: 'React الأساسيات',
          items: [
            { id: 'item_4', title: 'مقدمة لـ React', type: 'VIDEO', content: '', completed: true },
            { id: 'item_5', title: 'Components', type: 'TEXT', content: '', completed: true },
            { id: 'item_6', title: 'State وProps', type: 'VIDEO', content: '', completed: true }
          ]
        }
      ],
      category: 'Technology',
      createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
      id: 'demo_course_3',
      title: 'إدارة المشاريع الرقمية',
      description: 'احترف إدارة المشاريع باستخدام منهجيات Agile',
      instructor: 'د. خالد يوسف',
      level: 'Advanced',
      price: 2500,
      thumbnail: 'https://images.unsplash.com/photo-1552664730-d307ca884978?w=800',
      modules: [
        {
          id: 'mod_4',
          title: 'مقدمة في Agile',
          items: [
            { id: 'item_7', title: 'ما هو Agile؟', type: 'TEXT', content: '', completed: true },
            { id: 'item_8', title: 'Scrum Framework', type: 'VIDEO', content: '', completed: true },
            { id: 'item_9', title: 'Sprint Planning', type: 'TEXT', content: '', completed: true },
            { id: 'item_10', title: 'Retrospectives', type: 'VIDEO', content: '', completed: false }
          ]
        }
      ],
      category: 'Business',
      createdAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString()
    }
  ];

  const instructorCourses: Course[] = [
    {
      id: 'demo_inst_course_1',
      title: 'Python للمبتدئين',
      description: 'تعلم البرمجة من الصفر',
      instructor: 'Guest Instructor',
      level: 'Beginner',
      price: 1200,
      thumbnail: 'https://images.unsplash.com/photo-1526379095098-d400fd0bf935?w=800',
      modules: [
        { id: 'mod_inst_1', title: 'الأساسيات', items: [] },
        { id: 'mod_inst_2', title: 'التطبيقات', items: [] }
      ],
      category: 'Technology',
      createdAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
      id: 'demo_inst_course_2',
      title: 'تصميم تجربة المستخدم UX',
      description: 'أسس تصميم تجارب المستخدم الاحترافية',
      instructor: 'Guest Instructor',
      level: 'Intermediate',
      price: 1800,
      thumbnail: 'https://images.unsplash.com/photo-1561070791-2526d30994b5?w=800',
      modules: [
        { id: 'mod_inst_3', title: 'مبادئ UX', items: [] }
      ],
      category: 'Design',
      createdAt: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString()
    }
  ];

  return role === 'STUDENT' ? studentCourses : instructorCourses;
}

/**
 * Generate mock course progress for guest students
 */
export function generateGuestCourseProgress(courses: Course[], userId: string): CourseProgress[] {
  return courses.map((course, index) => {
    const progressValues = [25, 60, 90];
    const completedItemIds = course.modules.flatMap(m => 
      m.items.slice(0, Math.floor(m.items.length * (progressValues[index] / 100))).map(i => i.id)
    );
    const totalItems = course.modules.reduce((sum, m) => sum + m.items.length, 0);
    return {
      id: `demo_progress_${index}`,
      userId,
      courseId: course.id,
      progressPercent: progressValues[index] || 0,
      completedItemIds,
      totalItems,
      completedCount: completedItemIds.length,
      lastAccessedAt: new Date(Date.now() - (index + 1) * 24 * 60 * 60 * 1000).toISOString(),
      preTestCompleted: index === 2,
      preTestScore: index === 2 ? 85 : undefined,
      postTestCompleted: false
    };
  });
}

/**
 * Generate mock certificates for guest students
 */
export function generateGuestCertificates(userId: string): Certificate[] {
  return [
    {
      id: 'demo_cert_1',
      userId,
      courseId: 'demo_course_3',
      courseTitle: 'إدارة المشاريع الرقمية',
      userName: 'ضيف الأكاديمية',
      type: 'COMPLETION',
      issueDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      certificationNumber: 'DEMO-CERT-001',
      courseLevel: 'Advanced'
    }
  ];
}

/**
 * Generate mock credit transactions for guest students
 */
export function generateGuestCreditTransactions(userId: string): CreditTransaction[] {
  return [
    {
      id: 'demo_tx_1',
      userId,
      amount: 50,
      actionType: 'EARN',
      reason: 'QUIZ_COMPLETION',
      source: 'SYSTEM',
      createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
      id: 'demo_tx_2',
      userId,
      amount: 30,
      actionType: 'EARN',
      reason: 'ASSIGNMENT_SUBMISSION',
      source: 'SYSTEM',
      createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
      id: 'demo_tx_3',
      userId,
      amount: 70,
      actionType: 'EARN',
      reason: 'COURSE_COMPLETION',
      source: 'SYSTEM',
      createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
    }
  ];
}

/**
 * Generate mock payment records for guest students
 */
export function generateGuestPayments(userId: string, courses: Course[]): PaymentRecord[] {
  return [
    {
      id: 'demo_pay_1',
      studentId: userId,
      studentName: 'ضيف الأكاديمية',
      studentEmail: 'guest@demo.com',
      courseId: courses[0]?.id || 'demo_course_1',
      courseTitle: courses[0]?.title || 'مقدمة في الذكاء الاصطناعي',
      amount: 1500,
      paymentMethod: 'BANK_TRANSFER',
      receiptId: 'RCP-DEMO-001',
      receivedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
      id: 'demo_pay_2',
      studentId: userId,
      studentName: 'ضيف الأكاديمية',
      studentEmail: 'guest@demo.com',
      courseId: courses[1]?.id || 'demo_course_2',
      courseTitle: courses[1]?.title || 'تطوير تطبيقات الويب',
      amount: 2000,
      paymentMethod: 'CREDIT_CARD',
      receiptId: 'RCP-DEMO-002',
      receivedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    }
  ];
}

/**
 * Generate mock live classes for guest students
 */
export function generateGuestLiveClasses(userId: string): LiveClass[] {
  return [
    {
      id: 'demo_live_1',
      topic: 'ورشة عمل: الذكاء الاصطناعي التوليدي',
      agenda: 'نظرة عامة على نماذج GPT وتطبيقاتها',
      startTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      durationMinutes: 90,
      platform: 'zoom',
      joinUrl: 'https://zoom.us/j/demo',
      status: 'SCHEDULED',
      inviteType: 'all',
      invites: [{ 
        id: 'demo_invite_1',
        studentId: userId, 
        studentName: 'ضيف الأكاديمية',
        status: 'INVITED',
        createdAt: new Date().toISOString()
      }],
      createdAt: new Date().toISOString()
    }
  ];
}

/**
 * Generate mock instructor payment data
 */
export function generateInstructorMockPayments(instructorId: string, courses: Course[]): PaymentRecord[] {
  const payments: PaymentRecord[] = [];
  
  courses.forEach((course, index) => {
    // Generate 5-8 payments per course
    const paymentCount = 5 + index;
    for (let i = 0; i < paymentCount; i++) {
      payments.push({
        id: `demo_inst_pay_${course.id}_${i}`,
        studentId: `demo_student_${i}`,
        studentName: `Student ${i}`,
        studentEmail: `student${i}@demo.com`,
        courseId: course.id,
        courseTitle: course.title,
        amount: course.price || 1500,
        paymentMethod: i % 2 === 0 ? 'BANK_TRANSFER' : 'CREDIT_CARD',
        receiptId: `RCP-INST-${index}-${i}`,
        receivedAt: new Date(Date.now() - (i * 7 + index * 30) * 24 * 60 * 60 * 1000).toISOString(),
        createdAt: new Date(Date.now() - (i * 7 + index * 30) * 24 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date(Date.now() - (i * 7 + index * 30) * 24 * 60 * 60 * 1000).toISOString()
      });
    }
  });
  
  return payments;
}

/**
 * Generate mock students enrolled in instructor's courses
 */
export function generateInstructorMockStudents(courses: Course[]): User[] {
  const students: User[] = [];
  const names = [
    'أحمد محمود', 'فاطمة علي', 'محمد حسن', 'نور الدين', 'سارة أحمد',
    'يوسف خالد', 'مريم سعيد', 'عمر يوسف', 'ليلى حسين', 'كريم وليد'
  ];
  
  names.forEach((name, index) => {
    students.push({
      id: `demo_student_${index}`,
      email: `student${index}@demo.com`,
      name,
      role: UserRole.STUDENT,
      enrolledCourses: [courses[index % courses.length]?.id || ''],
      credits: Math.floor(Math.random() * 200),
      streak: Math.floor(Math.random() * 30)
    });
  });
  
  return students;
}

/**
 * Calculate total revenue for instructor from payments
 */
export function calculateInstructorRevenue(payments: PaymentRecord[]): { total: number; pending: number } {
  const total = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
  const pending = total * 0.2; // 20% pending payout
  return { total, pending };
}
