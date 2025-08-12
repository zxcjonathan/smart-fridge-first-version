document.addEventListener('DOMContentLoaded', () => {
    // DOM 元素獲取
    const uploadSection = document.getElementById('upload-section');
    const confirmSection = document.getElementById('confirm-section');
    const recipeResultsSection = document.getElementById('recipe-results-section');
    const loader = document.getElementById('loader');
    const loaderText = document.getElementById('loader-text');
    
    const fileInputs = document.querySelectorAll('.file-input');
    const identifyBtn = document.getElementById('identify-btn');
    const generateBtn = document.getElementById('generate-btn');
    const checklistContainer = document.getElementById('ingredient-checklist');
    const extraIngredientsInput = document.getElementById('extra-ingredients-input');
    const recipeResultsGrid = document.getElementById('recipe-results-grid');

    // 新增的返回按鈕
    const backToUploadBtn = document.getElementById('back-to-upload-btn');
    const backToConfirmBtn = document.getElementById('back-to-confirm-btn');

    // 直接從 DOM 獲取模態視窗元素，因為它在 HTML 中已經定義
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById("img01");
    const closeBtn = document.querySelector(".close-button"); 

    if (closeBtn) { // 確保 closeBtn 存在
        closeBtn.onclick = function() {
            modal.style.display = "none";
        }
    } else {
        console.error("關閉按鈕未找到！請檢查 HTML 中的 .close-button 元素。");
    }

    // 圖片預覽與重新選擇功能
    fileInputs.forEach(input => {
        const preview = document.getElementById(`preview${input.id.slice(-1)}`);

        // 當檔案輸入框內容改變時，更新圖片預覽
        input.addEventListener('change', event => {
            const file = event.target.files[0];
            if (file) {
                preview.src = URL.createObjectURL(file);
                preview.style.display = 'block'; // 顯示預覽圖片
            } else {
                // 如果沒有選擇檔案（例如：使用者取消了檔案選擇對話框），則清空預覽並隱藏
                preview.src = '';
                preview.style.display = 'none';
            }
        });

        // 為圖片預覽本身添加點擊事件，允許使用者重新選擇該位置的圖片
        if (preview) {
            preview.addEventListener('click', () => {
                input.click(); // 模擬點擊隱藏的檔案輸入框
            });
        }
    });

    // 辨識食材按鈕事件
    identifyBtn.addEventListener('click', async () => {
        const formData = new FormData();
        let fileCount = 0;
        fileInputs.forEach(input => {
            if (input.files[0]) {
                formData.append('images', input.files[0]);
                fileCount++;
            }
        });

        if (fileCount === 0) {
            alert('請至少上傳一張冰箱照片！');
            return;
        }

        showLoader('主廚正在掃描您的冰箱...');
        try {
            const response = await fetch('/api/identify-ingredients', {
                method: 'POST',
                body: formData,
            });
            const data = await response.json();
            if (data.success && data.ingredients.length > 0) {
                displayIngredientChecklist(data.ingredients);
                switchSection(confirmSection);
            } else {
                alert(`食材辨識失敗：${data.error || 'AI 未能辨識出任何可用食材，請嘗試更清晰的照片。'}`);
            }
        } catch (error) {
            console.error('Error:', error);
            alert('發生嚴重錯誤，請檢查後端伺服器是否運行。');
        } finally {
            hideLoader();
        }
    });

    // 生成食譜按鈕事件
    generateBtn.addEventListener('click', async () => {
        const selectedIngredients = Array.from(checklistContainer.querySelectorAll('input[type="checkbox"]:checked'))
            .map(checkbox => checkbox.value);
        
        const extraIngredients = extraIngredientsInput.value.trim()
            .split(/,|，|\s+/)
            .filter(item => item);

        const finalIngredients = [...new Set([...selectedIngredients, ...extraIngredients])]; // 使用 Set 去除重複項

        if (finalIngredients.length === 0) {
            alert('請至少選擇或輸入一樣食材！');
            return;
        }

        showLoader('大廚正在為您設計菜單...');
        try {
            const response = await fetch('/api/generate-recipes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ingredients: finalIngredients }),
            });
            const data = await response.json();
            if (data.success && data.recipes.length > 0) {
                displayRecipes(data.recipes);
                switchSection(recipeResultsSection);
            } else {
                alert(`食譜生成失敗：${data.error}`);
            }
        } catch (error) {
            console.error('Error:', error);
            alert('發生嚴重錯誤，無法生成食譜。');
        } finally {
            hideLoader();
        }
    });

    // 返回按鈕事件監聽器
    backToUploadBtn.addEventListener('click', () => {
        switchSection(uploadSection);
    });

    backToConfirmBtn.addEventListener('click', () => {
        switchSection(confirmSection);
    });

    // --- 輔助函式 ---
    const synth = window.speechSynthesis;
    let voices = [];

    function populateVoiceList() {
        if (typeof synth === 'undefined') return;
        voices = synth.getVoices().filter(voice => voice.lang.startsWith('zh'));
        if (voices.length === 0 && synth.onvoiceschanged !== undefined) {
            synth.onvoiceschanged = () => {
                voices = synth.getVoices().filter(voice => voice.lang.startsWith('zh'));
            };
        }
    }
    populateVoiceList();

    function speakText(text) {
        if (synth.speaking) {
            synth.cancel();
        }
        const utterance = new SpeechSynthesisUtterance(text);
        const taiwanFemaleVoice = voices.find(voice => voice.name === 'Google 國語（臺灣）') || 
                                     voices.find(voice => voice.lang === 'zh-TW');
        if (taiwanFemaleVoice) {
            utterance.voice = taiwanFemaleVoice;
        }
        utterance.pitch = 1;
        utterance.rate = 1;
        synth.speak(utterance);
    }

    // New function to play all steps sequentially
    function playAllSteps(steps) {
        if (synth.speaking) {
            synth.cancel();
        }

        let currentStepIndex = 0;
        const taiwanFemaleVoice = voices.find(voice => voice.name === 'Google 國語（臺灣）') || 
                                     voices.find(voice => voice.lang === 'zh-TW');

        function speakNextStep() {
            if (currentStepIndex < steps.length) {
                const utterance = new SpeechSynthesisUtterance(steps[currentStepIndex]);
                if (taiwanFemaleVoice) {
                    utterance.voice = taiwanFemaleVoice;
                }
                utterance.pitch = 1;
                utterance.rate = 1;
                utterance.onend = () => {
                    currentStepIndex++;
                    speakNextStep();
                };
                synth.speak(utterance);
            }
        }
        speakNextStep();
    }

    /**
     * 從標準 YouTube 影片 URL 中提取影片 ID 並轉換為嵌入式 URL。
     * 假設後端已經處理了 googleusercontent.com 代理連結，並回傳標準 YouTube URL。
     * @param {string} url - 標準 YouTube 影片 URL。
     * @returns {string} 嵌入式 YouTube URL 或空字串（如果無法解析）。
     */
    function convertToEmbedUrl(url) {
        if (!url) return '';
        try {
            // 如果 URL 已經是嵌入式 URL (包含 'embed/' 或 'youtube-nocookie.com/embed/'), 直接返回
            // 並確保添加 rel=0 參數
            if (url.includes("embed/") || url.includes("youtube-nocookie.com/embed/")) {
                if (!url.includes("?rel=0") && !url.includes("&rel=0")) {
                    return url + (url.includes("?") ? "&" : "?") + "rel=0";
                }
                return url;
            }

            let videoId = '';
            // 匹配標準 YouTube 連結和短連結
            const youtubeRegex = /(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
            let match = url.match(youtubeRegex);

            if (match && match[1]) {
                videoId = match[1];
            } else {
                console.warn(`無法從 URL 提取 YouTube Video ID (非標準 YouTube URL): ${url}`);
                return ''; // 無法提取 ID
            }
            
            // 如果成功獲取到 videoId，則返回標準的 YouTube 嵌入式 URL
            // 使用 youtube-nocookie.com 以增強隱私，並確保兼容性
            if (videoId) {
                return `https://www.youtube-nocookie.com/embed/${videoId}?rel=0`; // rel=0 禁用相關影片推薦
            } else {
                return '';
            }
        } catch (e) {
            console.error("無效的影片網址或解析錯誤:", url, e);
            return '';
        }
    }

    function showLoader(text) {
        loaderText.textContent = text;
        loader.style.display = 'flex';
    }

    function hideLoader() {
        loader.style.display = 'none';
    }

    function switchSection(activeSection) {
        [uploadSection, confirmSection, recipeResultsSection].forEach(s => s.classList.remove('active'));
        activeSection.classList.add('active');
    }

    function displayIngredientChecklist(ingredients) {
        checklistContainer.innerHTML = ingredients.map(ing => `
            <div class="checklist-item">
                <input type="checkbox" id="ing-${ing}" value="${ing}" checked>
                <label for="ing-${ing}">${ing}</label>
            </div>
        `).join('');
    }

    function displayRecipes(recipes) {
        recipeResultsGrid.innerHTML = recipes.map(recipe => {
            const videoEmbedUrl = convertToEmbedUrl(recipe.video_url);

            // 確保 ingredients 和 seasonings 都是陣列，且內部元素為字串
            const ingredientsHtml = (recipe.ingredients || []).map(item => `<li>${String(item)}</li>`).join('');
            const seasoningsHtml = (recipe.seasonings || []).map(item => `<li>${String(item)}</li>`).join('');

            // 判斷是否有有效的圖片 URL，如果沒有則不渲染圖片
            // 添加 onerror="this.style.display='none'" 來隱藏載入失敗的圖片
            const imageHtml = recipe.image_url ? 
                `<img class="recipe-main-image" src="${recipe.image_url}" alt="${recipe.title}" loading="lazy" data-fullsrc="${recipe.image_url}" onerror="this.style.display='none'; this.alt='圖片載入失敗或不存在'; console.error('圖片載入失敗:', this.src);">` : '';

            return `
            <div class="recipe-card">
                <h3><i class="fa-solid fa-bowl-food"></i> ${recipe.title}</h3>
                <div class="recipe-card-body">
                    <p class="recipe-description">${recipe.description}</p>
                    <div class="recipe-visuals">
                        ${imageHtml}
                        ${videoEmbedUrl ? `
                            <h4><i class="fa-brands fa-youtube"></i> 教學影片</h4>
                            <div class="video-container">
                                <iframe src="${videoEmbedUrl}" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
                            </div>
                        ` : ''}
                    </div>
                    <div class="recipe-meta">
                        <span><strong><i class="fa-regular fa-clock"></i> 準備:</strong> ${recipe.prep_time}</span>
                        <span><strong><i class="fa-solid fa-fire-burner"></i> 烹飪:</strong> ${recipe.cook_time}</span>
                        <span><strong><i class="fa-solid fa-user-group"></i> 份量:</strong> ${recipe.servings}</span>
                        <span><strong><i class="fa-solid fa-fire"></i> 熱量:</strong> ${recipe.calories || 'N/A'}</span>
                        <span><strong><i class="fa-solid fa-seedling"></i> 營養:</strong> ${recipe.nutrition_info || 'N/A'}</span>
                    </div>
                    <div class="recipe-details">
                        <div class="ingredients-list">
                            <h4><i class="fa-solid fa-carrot"></i> 食材清單</h4>
                            <ul>${ingredientsHtml}</ul>
                            <h4><i class="fa-solid fa-wine-bottle"></i> 調味料</h4>
                            <ul>${seasoningsHtml}</ul>
                        </div>
                    </div>
                    <div class="steps-list">
                        <div class="steps-header">
                            <h4><i class="fa-solid fa-list-ol"></i> 料理步驟</h4>
                            <button class="play-all-steps-btn">
                                <i class="fa-solid fa-play"></i> 播放所有步驟
                            </button>
                        </div>
                        <ol>
                            ${(recipe.steps || []).map(step => `
                                <li class="step-item">
                                    <span class="step-text">${step}</span>
                                    <button class="speak-btn" data-text="${step}" title="朗讀此步驟">
                                        <i class="fa-solid fa-volume-high"></i>
                                    </button>
                                </li>
                            `).join('')}
                        </ol>
                    </div>
                    <div class="chef-tip">
                        <strong><i class="fa-solid fa-lightbulb"></i> 主廚小提示:</strong> ${recipe.chef_tip || '享受您的料理吧！'}
                    </div>
                </div>
            </div>`;
        }).join('');

        // 為所有 speak-btn 綁定事件監聽器
        document.querySelectorAll('.speak-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const textToSpeak = e.currentTarget.getAttribute('data-text');
                speakText(textToSpeak);
            });
        });

        // 為所有 play-all-steps-btn 綁定事件監聽器
        document.querySelectorAll('.play-all-steps-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const recipeCard = e.currentTarget.closest('.recipe-card');
                const stepElements = recipeCard.querySelectorAll('.step-item .step-text');
                const steps = Array.from(stepElements).map(el => el.textContent);
                playAllSteps(steps);
            });
        });

        // 為所有 recipe-main-image 綁定點擊事件，實現圖片放大 (如果圖片存在)
        document.querySelectorAll('.recipe-main-image').forEach(image => {
            image.addEventListener('click', (e) => {
                // 檢查圖片是否成功載入且 src 不為空
                if (e.target.src && e.target.style.display !== 'none') {
                    modal.style.display = "block";
                    modalImg.src = e.target.getAttribute('data-fullsrc');
                }
            });
        });
    }
});