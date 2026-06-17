import { PrismaClient, Role, ApplicationStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { DATABASE_URL } from '../src/config/config.js';

const connectionString = DATABASE_URL!;
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Seeding FairPath Study Database...');

  // 1. Create Users
  const hashedPassword = await bcrypt.hash('password123', 10);

  const studentUser = await prisma.user.upsert({
    where: { email: 'student@fairpath.com' },
    update: {},
    create: {
      email: 'student@fairpath.com',
      passwordHash: hashedPassword,
      role: Role.STUDENT,
      firstName: 'Alex',
      lastName: 'Mercer',
      countryOfOrigin: 'Canada',
      targetDestinations: ['United States', 'United Kingdom'],
      academicData: {
        gpa: '3.85',
        satScore: '1480',
        ieltsScore: '8.0',
        educationLevel: 'High School',
      },
      preferences: {
        budgetMax: '35000',
        desiredMajors: ['Computer Science', 'Data Science', 'Software Engineering'],
        campusSetting: 'URBAN',
        universityType: 'PUBLIC',
      },
      profileCompletionPercent: 75,
    },
  });

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@fairpath.com' },
    update: {},
    create: {
      email: 'admin@fairpath.com',
      passwordHash: hashedPassword,
      role: Role.ADMIN,
      firstName: 'Sarah',
      lastName: 'Connor',
      profileCompletionPercent: 40,
    },
  });

  console.log('✅ Seeded Users:');
  console.log(`   - Student: ${studentUser.email} (password: password123)`);
  console.log(`   - Admin:   ${adminUser.email} (password: password123)`);

  // 2. Create Universities
  const universities = [
    {
      name: 'Massachusetts Institute of Technology',
      slug: 'mit',
      locationCity: 'Cambridge',
      locationCountry: 'United States',
      rankingGlobal: 1,
      rankingNational: 1,
      tuitionMin: 57590,
      tuitionMax: 59750,
      setting: 'URBAN',
      type: 'PRIVATE',
      acceptanceRate: 4.8,
      studentBodySize: 11934,
      description:
        'MIT is a world-class educational institution known for its rigorous academic programs, cutting-edge research, and innovation in science and technology.',
      featuredImage:
        'https://lh3.googleusercontent.com/gps-cs-s/APNQkAGGQ1x0soj2ILzUcQxAmLDnLCX-2suw-HID4jq0m55d-AwymIdgZ0DcILkLnBAYLt9Tn1tvXvo0eqVJlF3_5-fknLkbv6LCSmjo9ZMcaEUbCR0WSXiIN1Xull9RqTHMWHh4KsE=s680-w680-h510-rw',
      departments: [
        'School of Engineering',
        'School of Science',
        'Sloan School of Management',
        'School of Architecture',
      ],
      isFeatured: true,
      isPartner: true,
      details: {
        academics: {
          graduationRate: "98%",
          ratio: "3:1",
          laureates: 98,
          calendar: [
            { period: "Autumn Semester", dates: "Sep 7 – Dec 22" },
            { period: "Spring Semester", dates: "Feb 5 – May 28" }
          ]
        },
        campusLife: {
          clubs: 450,
          residences: [
            { name: "Maseeh Hall", price: "$6,500/semester", badge: "Historic" },
            { name: "Simmons Hall", price: "$7,200/semester", badge: "Iconic Design" }
          ]
        },
        admissions: {
          acceptanceRate: "4.8%",
          requirements: {
            undergrad: ["SAT 1550+ or ACT 35+", "IELTS 7.5+", "High School Transcripts"],
            postgrad: ["GRE/GMAT", "GPA 3.8+", "3 Letters of Recommendation"]
          }
        }
      }
    },
    {
      name: 'Stanford University',
      slug: 'stanford',
      locationCity: 'Stanford',
      locationCountry: 'United States',
      rankingGlobal: 3,
      rankingNational: 2,
      tuitionMin: 55473,
      tuitionMax: 57693,
      setting: 'SUBURBAN',
      type: 'PRIVATE',
      acceptanceRate: 3.9,
      studentBodySize: 16937,
      description:
        "Stanford University, located in the heart of Silicon Valley, is renowned for its academic strength, wealth, proximity to tech giants, and beautiful campus.",
      featuredImage:
        'https://lh3.googleusercontent.com/gps-cs-s/APNQkAEK2YzU6w6DtlM98-S3dQvyhfB_NmNw1qLZNuDSdhWfpzq4GnFCu0dTB0kRZ5oqq7jOfJxxYSLcwYZZzAJ71yKDtopGs2XSOre08UO29l1e1Q8k_KyiMslSeqA3N6a2LqjTjbCyGZD5Q44=s680-w680-h510-rw',
      departments: [
        'School of Engineering',
        'School of Humanities and Sciences',
        'Graduate School of Business',
      ],
      isFeatured: true,
      isPartner: true,
      details: {
        academics: {
          graduationRate: "95%",
          ratio: "5:1",
          laureates: 84,
          calendar: [
            { period: "Autumn Quarter", dates: "Sep 25 – Dec 15" },
            { period: "Winter Quarter", dates: "Jan 8 – Mar 22" },
            { period: "Spring Quarter", dates: "Apr 1 – Jun 12" }
          ]
        },
        campusLife: {
          clubs: 650,
          residences: [
            { name: "Toyon Hall", price: "$5,800/quarter", badge: "Most Popular" },
            { name: "Branner Hall", price: "$6,100/quarter", badge: "Freshman Dorm" }
          ]
        },
        admissions: {
          acceptanceRate: "3.9%",
          requirements: {
            undergrad: ["SAT 1500+ or ACT 34+", "IELTS 7.5+", "Personal Essays"],
            postgrad: ["GRE / MCAT / LSAT", "GPA 3.7+", "Statement of Purpose"]
          }
        }
      }
    },
    {
      name: 'University of Oxford',
      slug: 'oxford',
      locationCity: 'Oxford',
      locationCountry: 'United Kingdom',
      rankingGlobal: 4,
      rankingNational: 1,
      tuitionMin: 32000,
      tuitionMax: 48000,
      setting: 'URBAN',
      type: 'PUBLIC',
      acceptanceRate: 14.3,
      studentBodySize: 25000,
      description:
        'The University of Oxford is the oldest university in the English-speaking world. It is highly prestigious and consistently ranked among the top universities globally.',
      featuredImage:
        'https://lh3.googleusercontent.com/gps-cs-s/APNQkAH955xibhDMJnoXPB5A2QpVtdLsAZSIFacFCVzZ9LTeFFHTTrihTenXbP2a3s9TGT4lF5WFOgRTIG5uRnJZd8zklULlmUxAsv1-3PUM422G2yUStrbs93Dw3trXHt0qL8siDubYzA=s680-w680-h510-rw',
      departments: [
        'Mathematical, Physical and Life Sciences',
        'Humanities',
        'Medical Sciences',
        'Social Sciences',
      ],
      isFeatured: false,
      isPartner: false,
      details: {
        academics: {
          graduationRate: "97%",
          ratio: "11:1",
          laureates: 72,
          calendar: [
            { period: "Michaelmas Term", dates: "Oct 12 – Dec 5" },
            { period: "Hilary Term", dates: "Jan 17 – Mar 12" },
            { period: "Trinity Term", dates: "Apr 25 – Jun 18" }
          ]
        },
        campusLife: {
          clubs: 400,
          residences: [
            { name: "Balliol College Rooms", price: "£150 – £220/wk", badge: "Historic" },
            { name: "Christ Church Rooms", price: "£180 – £260/wk", badge: "Premium" }
          ]
        },
        admissions: {
          acceptanceRate: "14.3%",
          requirements: {
            undergrad: ["A-Levels: A*A*A", "IELTS 7.5 (min 7.0 per band)"],
            postgrad: ["First-Class Honours (or GPA 3.8+)", "Research Proposal"]
          }
        }
      }
    },
    {
      name: 'University of Toronto',
      slug: 'utoronto',
      locationCity: 'Toronto',
      locationCountry: 'Canada',
      rankingGlobal: 21,
      rankingNational: 1,
      tuitionMin: 35000,
      tuitionMax: 60000,
      setting: 'URBAN',
      type: 'PUBLIC',
      acceptanceRate: 43.0,
      studentBodySize: 61000,
      description:
        "A global leader in research and education, U of T offers an outstanding environment for students wishing to explore their intellectual potential in Canada's largest city.",
      featuredImage:
        'https://lh3.googleusercontent.com/gps-cs-s/APNQkAGSBlSpKnquwgtk-Lf1UryAiCNaZTtLehsUDZZx3I4iOy3d1LBbSdS-Oip2suCnRipMPeONggnB2vdVcGISxNs20FVXkj5qkADhDAn3b1NQh4i9rvEmaSIixe5JmLKEEwIk4iWI=s680-w680-h510-rw',
      departments: [
        'Faculty of Applied Science & Engineering',
        'Faculty of Arts & Science',
        'Rotman School of Management',
      ],
      isFeatured: true,
      isPartner: false,
      details: {
        academics: {
          graduationRate: "89%",
          ratio: "19:1",
          laureates: 10,
          calendar: [
            { period: "Fall Session", dates: "Sep 8 – Dec 21" },
            { period: "Winter Session", dates: "Jan 4 – Apr 30" }
          ]
        },
        campusLife: {
          clubs: 800,
          residences: [
            { name: "University College", price: "$12,000/academic yr", badge: "Historic" },
            { name: "Chestnut Residence", price: "$16,000/academic yr", badge: "Full Dining Included" }
          ]
        },
        admissions: {
          acceptanceRate: "43%",
          requirements: {
            undergrad: ["GPA 3.5+", "IELTS 6.5+ (no band under 6.0)"],
            postgrad: ["Mid-B Equivalent (or GPA 3.3+)", "2 Academic References"]
          }
        }
      }
    },
    {
      name: 'University of Melbourne',
      slug: 'unimelb',
      locationCity: 'Melbourne',
      locationCountry: 'Australia',
      rankingGlobal: 33,
      rankingNational: 1,
      tuitionMin: 28000,
      tuitionMax: 45000,
      setting: 'URBAN',
      type: 'PUBLIC',
      acceptanceRate: 70.0,
      studentBodySize: 52000,
      description:
        'Ranked number one in Australia, the University of Melbourne is a leading international university with a tradition of excellence in research and teaching.',
      featuredImage:
        'https://lh3.googleusercontent.com/gps-cs-s/APNQkAFjxgSA3JUirLxc4rpjZhv5cx8t-NdRvLbxKh2V-cgudyh2TUJyLn9Q4RGHWeQopG9R23HutlqNoeFzbSsYHaVc_kb0-Ou-7AdcC65-y5eSM7DfnRhP3lNFI7X4JAJRZ9UqbM4x2w=s680-w680-h510-rw',
      departments: [
        'Faculty of Science',
        'Melbourne School of Engineering',
        'Faculty of Business and Economics',
      ],
      isFeatured: false,
      isPartner: true,
      details: {
        academics: {
          graduationRate: "86%",
          ratio: "22:1",
          laureates: 8,
          calendar: [
            { period: "Semester 1", dates: "Mar 1 – Jun 20" },
            { period: "Semester 2", dates: "Jul 26 – Nov 14" }
          ]
        },
        campusLife: {
          clubs: 200,
          residences: [
            { name: "University Hall", price: "AUD 380/wk", badge: "On-campus" },
            { name: "Little Hall", price: "AUD 450/wk", badge: "Premium Student Living" }
          ]
        },
        admissions: {
          acceptanceRate: "70%",
          requirements: {
            undergrad: ["ATAR 85+ (or international equivalent)", "IELTS 6.5+"],
            postgrad: ["Weighted Average Mark (WAM) 65%+", "CV / Resume"]
          }
        }
      }
    },
  ];

  console.log('🏫 Seeding Universities...');
  const seededUniversities = [];
  for (const univ of universities) {
    const dbUniv = await prisma.university.upsert({
      where: { slug: univ.slug },
      update: univ,
      create: univ,
    });
    seededUniversities.push(dbUniv);
  }

  // 3. Create Scholarships
  const scholarships = [
    {
      title: 'Global Leaders STEM Scholarship',
      provider: 'Stanford University',
      amountType: 'Full Tuition',
      amountValue: 57000,
      amountMaxValue: 57000,
      deadline: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000), // 25 days from now
      category: 'STEM',
      eligibilityCriteria:
        'Minimum GPA of 3.7. Applicants must be enrolled in Computer Science, Software Engineering or related STEM fields. International applicants welcome.',
    },
    {
      title: 'Merit Excellence Award',
      provider: 'University of Oxford',
      amountType: 'Range',
      amountValue: 15000,
      amountMaxValue: 30000,
      deadline: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000), // 45 days
      category: 'Merit',
      eligibilityCriteria:
        'Minimum GPA of 3.8. Demonstrable leadership potential and high academic achievement in high school or undergraduate studies.',
    },
    {
      title: 'Diversity Opportunity Fund',
      provider: 'Massachusetts Institute of Technology',
      amountType: 'Fixed',
      amountValue: 25000,
      amountMaxValue: 25000,
      deadline: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // 10 days from now
      category: 'Need-based',
      eligibilityCriteria:
        'Available for international students from developing nations. Applicants must demonstrate financial need and maintain a minimum GPA of 3.0.',
    },
    {
      title: 'Women in Tech Scholarship',
      provider: 'Google Org Foundation',
      amountType: 'Fixed',
      amountValue: 10000,
      amountMaxValue: 10000,
      deadline: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), // 60 days
      category: 'STEM',
      eligibilityCriteria:
        'Identify as female, enrolled in Computer Science, Data Science or Computing, GPA >= 3.5.',
    },
  ];

  console.log('🎓 Seeding Scholarships...');
  for (const schol of scholarships) {
    await prisma.scholarship.create({
      data: schol,
    });
  }

  // 4. Create an Application for the student
  const mitUniv = seededUniversities.find((u) => u.slug === 'mit');
  if (mitUniv) {
    await prisma.application.create({
      data: {
        userId: studentUser.id,
        universityId: mitUniv.id,
        programId: 'Computer Science & AI',
        status: ApplicationStatus.SUBMITTED,
        deadline: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // 15 days
        documents: ['resume_alex.pdf', 'sop_alex.pdf'],
      },
    });
  }

  // 5. Create a saved match (favourite) for the student
  const stanfordUniv = seededUniversities.find((u) => u.slug === 'stanford');
  if (stanfordUniv) {
    await prisma.savedMatch.create({
      data: {
        userId: studentUser.id,
        matchType: 'UNIVERSITY',
        matchId: stanfordUniv.id,
      },
    });
  }

  console.log('✅ Database Seeding Completed Successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
