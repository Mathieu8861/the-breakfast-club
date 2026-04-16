(function() {
    'use strict';

    // === CONSTANTS ===
    const SCROLL_THRESHOLD = 80;
    const MOBILE_BREAKPOINT = 768;

    // === SELECTORS ===
    const header = document.getElementById('header');
    const navToggle = document.getElementById('nav-toggle');
    const navMenu = document.getElementById('nav-menu');

    // === UTILITIES ===
    function isMobile() {
        return window.innerWidth <= MOBILE_BREAKPOINT;
    }

    // === MENU MOBILE ===
    function toggleMenu() {
        navToggle.classList.toggle('active');
        navMenu.classList.toggle('active');
        document.body.classList.toggle('menu-open');
    }

    function closeMenu() {
        navToggle.classList.remove('active');
        navMenu.classList.remove('active');
        document.body.classList.remove('menu-open');
    }

    // === HEADER SCROLL ===
    function handleScroll() {
        if (window.scrollY > SCROLL_THRESHOLD) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
        }
    }

    // === SCROLL REVEAL ===
    function initReveal() {
        const reveals = document.querySelectorAll('.section__tag, .section__title, .section__subtitle, .service-card, .concept__problem, .concept__solution, .result-card, .testimonial, .pricing__card, .booking__slot, .contact__item');

        reveals.forEach(function(el) {
            el.classList.add('reveal');
        });

        var observer = new IntersectionObserver(function(entries) {
            entries.forEach(function(entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                }
            });
        }, {
            threshold: 0.1,
            rootMargin: '0px 0px -50px 0px'
        });

        reveals.forEach(function(el) {
            observer.observe(el);
        });
    }

    // === SMOOTH SCROLL FOR ANCHOR LINKS ===
    function initSmoothScroll() {
        document.querySelectorAll('a[href^="#"]').forEach(function(anchor) {
            anchor.addEventListener('click', function(e) {
                var targetId = this.getAttribute('href');
                if (targetId === '#') return;

                var target = document.querySelector(targetId);
                if (target) {
                    e.preventDefault();
                    closeMenu();
                    target.scrollIntoView({ behavior: 'smooth' });
                }
            });
        });
    }

    // === ACTIVE NAV LINK ===
    function initActiveNav() {
        var sections = document.querySelectorAll('section[id]');
        var navLinks = document.querySelectorAll('.nav__link');

        var observer = new IntersectionObserver(function(entries) {
            entries.forEach(function(entry) {
                if (entry.isIntersecting) {
                    navLinks.forEach(function(link) {
                        link.classList.remove('active');
                        if (link.getAttribute('href') === '#' + entry.target.id) {
                            link.classList.add('active');
                        }
                    });
                }
            });
        }, {
            threshold: 0.3,
            rootMargin: '-100px 0px -50% 0px'
        });

        sections.forEach(function(section) {
            observer.observe(section);
        });
    }

    // === EVENT LISTENERS ===
    if (navToggle) {
        navToggle.addEventListener('click', toggleMenu);
    }

    document.querySelectorAll('.nav__link').forEach(function(link) {
        link.addEventListener('click', closeMenu);
    });

    window.addEventListener('scroll', handleScroll, { passive: true });

    // === TESTIMONIALS CAROUSEL ===
    function initTestimonialsCarousel() {
        var track = document.querySelector('.testimonials__track');
        if (!track) return;

        var slides = track.querySelectorAll('.testimonial');
        var dots = document.querySelectorAll('.testimonials__dot');
        var prevBtn = document.querySelector('.testimonials__arrow--prev');
        var nextBtn = document.querySelector('.testimonials__arrow--next');
        var current = 0;

        function goTo(index) {
            if (index < 0) index = slides.length - 1;
            if (index >= slides.length) index = 0;

            slides.forEach(function(slide) {
                slide.classList.remove('testimonial--active');
            });
            dots.forEach(function(dot) {
                dot.classList.remove('testimonials__dot--active');
            });

            slides[index].classList.add('testimonial--active');
            if (dots[index]) dots[index].classList.add('testimonials__dot--active');
            current = index;
        }

        if (prevBtn) prevBtn.addEventListener('click', function() { goTo(current - 1); });
        if (nextBtn) nextBtn.addEventListener('click', function() { goTo(current + 1); });

        dots.forEach(function(dot, i) {
            dot.addEventListener('click', function() { goTo(i); });
        });

        // Auto-play every 6 seconds
        setInterval(function() { goTo(current + 1); }, 6000);
    }

    // === OBJECTIVE BUTTONS ===
    function initObjectiveButtons() {
        var buttons = document.querySelectorAll('.objective-btn');
        var objectiveWrap = document.getElementById('booking-objective');
        var objectiveValue = document.getElementById('booking-objective-value');
        var bookingCta = document.getElementById('booking-cta');

        if (!buttons.length || !objectiveWrap || !bookingCta) return;

        var baseMsg = 'Bonjour ! Je souhaite r\u00e9server un cr\u00e9neau au Breakfast Club';

        buttons.forEach(function(btn) {
            btn.addEventListener('click', function() {
                var obj = btn.getAttribute('data-objective');
                if (!obj) return;

                // Decode HTML entities (e.g. &eacute;)
                var tmp = document.createElement('textarea');
                tmp.innerHTML = obj;
                var decoded = tmp.value;

                objectiveValue.textContent = decoded;
                objectiveWrap.removeAttribute('hidden');

                var msg = baseMsg + '. Mon objectif : ' + decoded + ' \ud83c\udf53';
                bookingCta.href = 'https://wa.me/32470120300?text=' + encodeURIComponent(msg);

                // Mark button as active, clear others
                buttons.forEach(function(b) { b.classList.remove('objective-btn--active'); });
                btn.classList.add('objective-btn--active');
            });
        });
    }

    // === INIT ===
    handleScroll();
    initReveal();
    initSmoothScroll();
    initActiveNav();
    initTestimonialsCarousel();
    initObjectiveButtons();

})();
