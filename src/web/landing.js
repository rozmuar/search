// Landing page JavaScript

document.addEventListener('DOMContentLoaded', function() {
    // Demo search functionality
    const demoSearch = document.getElementById('demoSearch');
    const demoResults = document.getElementById('demoResults');

    if (demoSearch) {
        let debounceTimer;
        
        demoSearch.addEventListener('input', function(e) {
            clearTimeout(debounceTimer);
            
            const query = e.target.value.trim();
            
            if (query.length < 2) {
                demoResults.innerHTML = '';
                return;
            }
            
            debounceTimer = setTimeout(() => {
                searchDemo(query);
            }, 300);
        });
    }

    async function searchDemo(query) {
        try {
            demoResults.innerHTML = '<div style="padding: 1rem; color: #64748b;">Поиск...</div>';
            
            // Всегда используем относительный путь
            const response = await fetch(`/api/v1/search?q=${encodeURIComponent(query)}&project_id=demo&limit=5`);
            
            if (!response.ok) {
                throw new Error('Search failed');
            }
            
            const data = await response.json();
            
            if (data.items && data.items.length > 0) {
                displayResults(data.items, data.meta?.took_ms || 0);
            } else {
                demoResults.innerHTML = '<div style="padding: 1rem; color: #64748b;">Ничего не найдено. Загрузите товары через личный кабинет.</div>';
            }
        } catch (error) {
            console.error('Search error:', error);
            demoResults.innerHTML = `
                <div style="padding: 1rem; color: #ef4444;">
                    <strong>Демо недоступно</strong><br>
                    <small>Зарегистрируйтесь и загрузите товары для тестирования поиска</small>
                </div>
            `;
        }
    }

    function displayResults(items, tookMs) {
        const html = items.map(item => `
            <div style="padding: 1rem; border-bottom: 1px solid #e2e8f0; cursor: pointer; transition: background 0.2s;" 
                 onmouseover="this.style.background='#f8fafc'" 
                 onmouseout="this.style.background='white'">
                <div style="font-weight: 600; margin-bottom: 0.25rem;">${item.name}</div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="color: #2563eb; font-weight: 600;">${formatPrice(item.price)} ₽</span>
                    <span style="color: #64748b; font-size: 0.875rem;">Score: ${item.score}</span>
                </div>
                ${item.in_stock ? 
                    '<span style="color: #22c55e; font-size: 0.875rem;">✓ В наличии</span>' : 
                    '<span style="color: #ef4444; font-size: 0.875rem;">Нет в наличии</span>'
                }
            </div>
        `).join('');
        
        demoResults.innerHTML = html + `
            <div style="padding: 1rem; text-align: center; color: #64748b; font-size: 0.875rem;">
                Найдено: ${items.length} товаров за ${tookMs}ms
            </div>
        `;
    }

    function formatPrice(price) {
        return price.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    }

    // Smooth scroll for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const href = this.getAttribute('href');
            if (href !== '#' && href.length > 1) {
                e.preventDefault();
                const target = document.querySelector(href);
                if (target) {
                    target.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                    });
                }
            }
        });
    });

    // Animation on scroll
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -100px 0px'
    };

    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);

    document.querySelectorAll('.feature-card, .pricing-card').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        el.style.transition = 'opacity 0.6s, transform 0.6s';
        observer.observe(el);
    });
});
