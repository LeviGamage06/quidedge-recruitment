export const hiringRole = {
  id:'e2173dde-bc77-409a-96a1-86dcb23841f0',
  title:'Client Acquisition & Client Relations Specialist',
  company:'QuidEdge',
  location:'Remote | Work From Anywhere',
  employment:'Independent Contractor | Commission-Based only',
  industry:'Personal Branding | Business Branding | Content Creation',
  compensation:'100% commission-based. No fixed salary. 10%, 20% or 30% recurring monthly commission on eligible acquired client contracts, subject to the agreed terms.',
  important:'Only candidates genuinely comfortable with a commission-only compensation structure should apply. Candidates must understand and accept the agreed terms before progressing.',
  about:[
    'At QuidEdge, we believe great brands are built through meaningful relationships, creative thinking, and strategies that deliver real business value.',
    'We are a dedicated team of professionals specialising in personal branding, business branding, content creation, social media management, and business development consulting.',
    'We work with founders, entrepreneurs, creators, and businesses to help them strengthen their market presence, communicate their value, and build brands that people genuinely connect with.',
    'We are not interested in simply selling services. We believe in understanding businesses, solving real problems, and building long-term partnerships.',
    'As we continue expanding internationally, we are looking for passionate and ambitious individuals to join our team as Client Acquisition & Client Relations Specialists.'
  ],
  overview:[
    'This is not a traditional sales position. Successful client acquisition starts with trust, genuine conversations, and understanding what a business actually needs.',
    'Identify potential clients, build professional relationships, introduce QuidEdge’s solutions, and guide prospects through the acquisition process.',
    'Maintain strong client relationships and ensure a positive experience throughout their journey with us.'
  ],
  responsibilities:[
    'Identify and research potential clients, including founders, entrepreneurs, creators, and business decision-makers.',
    'Connect with qualified prospects through LinkedIn, email, professional networks, and other appropriate outreach channels.',
    'Build genuine relationships instead of relying on generic or aggressive sales pitches.',
    'Understand prospective clients’ business challenges, branding needs, goals, and growth opportunities.',
    'Present QuidEdge’s services professionally and communicate how our team can deliver value.',
    'Conduct discovery conversations, handle enquiries, and coordinate proposals with our internal team.',
    'Manage the client acquisition journey from initial outreach to successful agreement.',
    'Maintain accurate records of prospect communications, follow-ups, and client interactions.',
    'Build and maintain positive, long-term relationships with acquired clients.',
    'Collaborate with our leadership, creative, and operations teams to ensure smooth client onboarding and communication.',
    'Represent QuidEdge with professionalism, integrity, and confidentiality.'
  ],
  benefits:[
    ['Work From Anywhere','Enjoy the flexibility of working remotely while connecting with businesses and professionals internationally.'],
    ['Build Long-Term Income Opportunities','Develop a portfolio of clients that can generate recurring commissions rather than relying solely on one-time sales.'],
    ['A Supportive Team Culture','People should feel valued, respected, and supported. Collaboration, open communication, and continuous development are central to how we work.'],
    ['Professional Growth','Gain practical exposure to international business development, client negotiations, brand strategy, and relationship management.'],
    ['Your Ideas Matter','We encourage initiative and fresh perspectives. Contribute to improving our client acquisition strategies and growing as a team.']
  ],
  tiers:[['10%','AUD 300–1,000 / month'],['20%','AUD 1,000–4,999 / month'],['30%','AUD 5,000+ / month']],
  payment:'Commission is uncapped and continues monthly while the client stays active and paying. Paid monthly in AUD after QuidEdge receives the client’s payment, subject to the agreed contract.',
  boundary:'The supplied tier ranges overlap at AUD 1,000. Confirm the applicable rate in the candidate’s agreement; this dashboard does not calculate or promise a rate at that boundary.',
  screening:[
    ['Experience','Walk through your last two roles. What outreach, discovery, closing and ongoing client relationship work did you personally own?'],
    ['Evidence','Describe a client you acquired. How did you identify them, qualify the need, build trust and reach an agreement? What was the commercial result?'],
    ['International communication','Which client markets have you worked with? Respond live to a prospect who asks for a guarantee of sales or viral results.'],
    ['Commission understanding','Explain the commission-only arrangement in your own words. Is there a fixed salary? When are commissions paid? What terms must you confirm?'],
    ['Client relations','Tell us about an unhappy client. What did you say first, how did you handle it and what changed?'],
    ['Confidentiality','A prospect asks for a competitor’s budget and private results. How would you respond?'],
    ['AI judgment','Which tools support your research and outreach? Give an example you rejected or verified before using.'],
    ['Remote readiness','Confirm working hours, market time zones, notice period, internet, backup power, call space and other commitments.']
  ]
};

export function defaultRoleRecord(date) {
  return {id:hiringRole.id,kind:'job',subject_id:null,event_date:date,payload:{
    title:hiringRole.title,department:'Client Services',location:'Remote · International',
    employment:'Commission-based',headcount:'1',status:'Open',profile:'client-acquisition-v1',
    brief:'Independent contractor. No fixed salary. 10% / 20% / 30% recurring commission on eligible acquired contracts under agreed terms. Own prospect research, outreach, discovery, proposals, closing, onboarding and ongoing client relations. Confirm terms and international communication readiness.'
  }};
}
